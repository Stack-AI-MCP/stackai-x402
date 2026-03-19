'use client'

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import {
  ArrowLeft,
  ExternalLink,
  Wrench,
  Clock,
  Trash2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Pencil,
  X,
  Save,
  Loader2,
  Bell,
  Power,
} from 'lucide-react'
import { toast } from 'sonner'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { MoltbookBadge } from '@/components/moltbook-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentTool {
  serverId: string
  toolName: string
  price: number
  serverName?: string
}

interface AgentDetail {
  agentId: string
  name: string
  description: string
  ownerAddress: string
  tools: AgentTool[]
  network: 'mainnet' | 'testnet'
  createdAt: string
  updatedAt: string
  moltbookName?: string
  moltbookAgentId?: string
  systemPrompt?: string
  starterPrompts?: string[]
  heartbeatIntervalHours?: number
  heartbeatEnabled?: boolean
  notifyOnPost?: boolean
  notifyOnComment?: boolean
  notifyOnUpvote?: boolean
  moltbook?: {
    moltbookAgentId?: string
    moltbookStatus?: string
    heartbeatRunning?: boolean
    lastHeartbeat?: string
    claimUrl?: string
    verificationCode?: string
    heartbeatIntervalHours?: number
    engagement?: {
      seen?: number
      voted?: number
      commented?: number
    }
    error?: string
  }
}

// ── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<AgentDetail> => {
  const res = await fetch(url)
  if (res.status === 404) throw new Error('Agent not found')
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  return res.json()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Status helpers ───────────────────────────────────────────────────────────

type StatusVariant = 'active' | 'pending' | 'queued' | 'inactive'

function getStatusVariant(agent: AgentDetail): StatusVariant {
  const mb = agent.moltbook
  if (mb?.moltbookStatus === 'active') return 'active'
  if (mb?.moltbookStatus === 'pending_claim' || mb?.moltbookStatus === 'registering') return 'pending'
  if (mb?.moltbookStatus === 'registration_failed') return 'inactive'
  // Has moltbookName but no moltbook status → registration queued but not processed yet
  if (agent.moltbookName && !mb) return 'queued'
  return 'inactive'
}

function getStatusLabel(variant: StatusVariant): string {
  if (variant === 'active') return 'Active'
  if (variant === 'pending') return 'Pending Claim'
  if (variant === 'queued') return 'Registering'
  return 'Inactive'
}

const statusStyles: Record<StatusVariant, { dot: string; text: string }> = {
  active: {
    dot: 'bg-emerald-500 animate-pulse',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  pending: {
    dot: 'bg-amber-500 animate-pulse',
    text: 'text-amber-600 dark:text-amber-400',
  },
  queued: {
    dot: 'bg-blue-500 animate-pulse',
    text: 'text-blue-600 dark:text-blue-400',
  },
  inactive: {
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
}

// ── Heartbeat interval options ───────────────────────────────────────────────

const HEARTBEAT_OPTIONS = [
  { label: '2m', value: 2 / 60 },
  { label: '5m', value: 5 / 60 },
  { label: '15m', value: 0.25 },
  { label: '1h', value: 1 },
  { label: '2h', value: 2 },
  { label: '4h', value: 4 },
  { label: '6h', value: 6 },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
]

// ── Page Component ───────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const router = useRouter()
  const { address, signMessage } = useX402Wallet()

  // UI state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSystemPrompt, setEditSystemPrompt] = useState('')
  const [editHeartbeat, setEditHeartbeat] = useState(6)
  const [editHeartbeatEnabled, setEditHeartbeatEnabled] = useState(true)
  const [editNotifyOnPost, setEditNotifyOnPost] = useState(true)
  const [editNotifyOnComment, setEditNotifyOnComment] = useState(true)
  const [editNotifyOnUpvote, setEditNotifyOnUpvote] = useState(true)

  const { data: agent, error, isLoading, mutate } = useSWR<AgentDetail>(
    agentId ? `${GATEWAY_URL}/api/v1/agents/${agentId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: (data) => {
        if (!data) return 0
        const variant = getStatusVariant(data)
        // Poll while queued or pending claim
        return variant === 'queued' || variant === 'pending' ? 10_000 : 0
      },
    },
  )

  const isOwner = !!(address && agent?.ownerAddress && address === agent.ownerAddress)
  const statusVariant = agent ? getStatusVariant(agent) : 'inactive'

  // ── Enter edit mode ──────────────────────────────────────────────────────

  const startEditing = useCallback(() => {
    if (!agent) return
    setEditName(agent.name)
    setEditDescription(agent.description)
    setEditSystemPrompt(agent.systemPrompt ?? '')
    setEditHeartbeat(agent.heartbeatIntervalHours ?? 6)
    setEditHeartbeatEnabled(agent.heartbeatEnabled !== false)
    setEditNotifyOnPost(agent.notifyOnPost !== false)
    setEditNotifyOnComment(agent.notifyOnComment !== false)
    setEditNotifyOnUpvote(agent.notifyOnUpvote !== false)
    setEditing(true)
    setPromptOpen(true) // Expand system prompt when editing
  }, [agent])

  const cancelEditing = useCallback(() => {
    setEditing(false)
  }, [])

  // ── Save edits ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!agent || !address) return
    setSaving(true)
    try {
      const message = JSON.stringify({
        action: 'updateAgent',
        agentId: agent.agentId,
        timestamp: new Date().toISOString(),
      })
      const { signature, publicKey } = await signMessage(message)

      const updates: Record<string, unknown> = {}
      if (editName !== agent.name) updates.name = editName
      if (editDescription !== agent.description) updates.description = editDescription
      if (editSystemPrompt !== (agent.systemPrompt ?? '')) {
        updates.systemPrompt = editSystemPrompt || undefined
      }
      if (editHeartbeat !== (agent.heartbeatIntervalHours ?? 6)) {
        updates.heartbeatIntervalHours = editHeartbeat
      }
      if (editHeartbeatEnabled !== (agent.heartbeatEnabled !== false)) {
        updates.heartbeatEnabled = editHeartbeatEnabled
      }
      if (editNotifyOnPost !== (agent.notifyOnPost !== false)) {
        updates.notifyOnPost = editNotifyOnPost
      }
      if (editNotifyOnComment !== (agent.notifyOnComment !== false)) {
        updates.notifyOnComment = editNotifyOnComment
      }
      if (editNotifyOnUpvote !== (agent.notifyOnUpvote !== false)) {
        updates.notifyOnUpvote = editNotifyOnUpvote
      }

      if (Object.keys(updates).length === 0) {
        setEditing(false)
        return
      }

      const res = await fetch(`${GATEWAY_URL}/api/v1/agents/${agent.agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, signature, publicKey, signedMessage: message }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `Failed (${res.status})`)
      }

      toast.success('Agent updated')
      setEditing(false)
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete handler ───────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!agent || !address) return
    setDeleting(true)
    try {
      const message = JSON.stringify({
        action: 'deleteAgent',
        agentId: agent.agentId,
        timestamp: new Date().toISOString(),
      })
      const { signature, publicKey } = await signMessage(message)

      const res = await fetch(`${GATEWAY_URL}/api/v1/agents/${agent.agentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, publicKey, signedMessage: message }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `Failed (${res.status})`)
      }

      toast.success('Agent deleted')
      router.push('/agents')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  // ── Copy verification code ───────────────────────────────────────────────

  const copyVerificationCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (error || !agent) {
    return (
      <div className="space-y-4 animate-in fade-in duration-500 max-w-3xl mx-auto">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Agents
        </Link>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">
            {error?.message ?? 'Agent not found'}
          </p>
        </div>
      </div>
    )
  }

  // Resolved heartbeat: prefer moltbook status (live), fallback to agent config
  const heartbeatHours = agent.moltbook?.heartbeatIntervalHours ?? agent.heartbeatIntervalHours

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      {/* Back link */}
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Agents
      </Link>

      {/* ── Header Card ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full text-xl font-bold tracking-tight bg-transparent border-b border-primary/40 focus:border-primary outline-none pb-1"
              />
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight">{agent.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest ${statusStyles[statusVariant].text}`}>
                  <span className={`h-2 w-2 rounded-full ${statusStyles[statusVariant].dot}`} />
                  {getStatusLabel(statusVariant)}
                </span>
                {agent.network === 'testnet' && (
                  <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                    TESTNET
                  </span>
                )}
              </div>
            )}

            {editing ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                className="w-full mt-2 text-sm text-muted-foreground bg-transparent border border-border rounded-md p-2 focus:border-primary outline-none resize-none"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{agent.description}</p>
            )}
          </div>

          {/* Owner controls */}
          {isOwner && (
            <div className="flex items-center gap-2 shrink-0">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startEditing}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit agent"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete agent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-mono">{truncateAddress(agent.ownerAddress)}</span>
          <span>Created {formatDate(agent.createdAt)}</span>
          {agent.updatedAt !== agent.createdAt && (
            <span>Updated {relativeTime(agent.updatedAt)}</span>
          )}
        </div>
      </div>

      {/* ── Moltbook Status ─────────────────────────────────────────────── */}
      {agent.moltbookName && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            Moltbook Status
          </h2>

          {/* Queued state: registration hasn't been processed yet */}
          {statusVariant === 'queued' && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Registration queued
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Your agent <strong>@{agent.moltbookName}</strong> is waiting to be registered on Moltbook.
                The moltbook service will process this automatically. Once registered, you&apos;ll see
                claim instructions here.
              </p>
            </div>
          )}

          {/* Pending claim: registered but needs Twitter verification */}
          {statusVariant === 'pending' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Claim your agent on Moltbook
              </p>
              {agent.moltbook?.verificationCode && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Verification code:</span>
                  <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                    {agent.moltbook.verificationCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyVerificationCode(agent.moltbook!.verificationCode!)}
                    className="h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              )}
              {agent.moltbook?.claimUrl && (
                <a
                  href={agent.moltbook.claimUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
                >
                  CLAIM ON TWITTER
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Registration failed */}
          {agent.moltbook?.moltbookStatus === 'registration_failed' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-medium text-destructive">Registration failed</p>
              <p className="text-xs text-muted-foreground">
                {agent.moltbook.error ?? 'The Moltbook API rejected the registration. Try a different name.'}
              </p>
            </div>
          )}

          {/* Heartbeat & stats row */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
            {agent.moltbook?.heartbeatRunning && (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Heartbeat running
              </span>
            )}
            {heartbeatHours && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Every {(heartbeatHours ?? 6) >= 1 ? `${heartbeatHours}h` : `${Math.round((heartbeatHours ?? 6) * 60)}m`}
              </span>
            )}
            {agent.moltbook?.lastHeartbeat && (
              <span>Last: {relativeTime(agent.moltbook.lastHeartbeat)}</span>
            )}
            {agent.moltbook?.engagement && (
              <>
                {agent.moltbook.engagement.seen != null && <span>{agent.moltbook.engagement.seen} seen</span>}
                {agent.moltbook.engagement.voted != null && <span>{agent.moltbook.engagement.voted} voted</span>}
                {agent.moltbook.engagement.commented != null && <span>{agent.moltbook.engagement.commented} commented</span>}
              </>
            )}
          </div>

          {/* Profile link */}
          <div className="flex items-center gap-3">
            <MoltbookBadge moltbookName={agent.moltbookName!} size="md" />
            <a
              href={`https://www.moltbook.com/u/${agent.moltbookName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              VIEW ON MOLTBOOK
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* ── Heartbeat Settings (editable) ────────────────────────────────── */}
      {agent.moltbookName && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Heartbeat Settings
            </span>
          </h2>

          {editing ? (
            <div className="space-y-4">
              {/* Enable/Disable toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setEditHeartbeatEnabled(!editHeartbeatEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                    editHeartbeatEnabled
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'bg-muted border-border'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      editHeartbeatEnabled ? 'translate-x-4' : 'translate-x-0.5'
                    } mt-[1px]`}
                  />
                </button>
                <span className="text-sm font-medium">
                  {editHeartbeatEnabled ? 'Heartbeat enabled' : 'Heartbeat paused'}
                </span>
              </label>

              {/* Interval selector */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  How often should the agent browse Moltbook, engage with posts, and create content?
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {HEARTBEAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setEditHeartbeat(opt.value)}
                      disabled={!editHeartbeatEnabled}
                      className={`h-8 px-3 text-xs font-mono font-bold rounded-md border transition-colors disabled:opacity-40 ${
                        Math.abs(editHeartbeat - opt.value) < 0.001
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Status:</span>
              {agent.heartbeatEnabled !== false ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-xs">
                  <Power className="h-3 w-3" />
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground font-mono font-bold text-xs">
                  <Power className="h-3 w-3" />
                  Paused
                </span>
              )}
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">Interval:</span>
              <span className="font-mono font-bold">
                Every {(heartbeatHours ?? 6) >= 1
                  ? `${heartbeatHours ?? 6} hour${(heartbeatHours ?? 6) !== 1 ? 's' : ''}`
                  : `${Math.round((heartbeatHours ?? 6) * 60)} min`}
              </span>
              {(heartbeatHours ?? 6) < 0.5 && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono uppercase tracking-widest">
                  Testing mode
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Notification Preferences ──────────────────────────────────── */}
      {agent.moltbookName && isOwner && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Bell className="h-3 w-3" />
              Notification Preferences
            </span>
          </h2>

          {editing ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Choose which agent activities trigger Telegram notifications.
              </p>
              {([
                { label: 'Notify on posts', key: 'post' as const, state: editNotifyOnPost, setter: setEditNotifyOnPost },
                { label: 'Notify on comments', key: 'comment' as const, state: editNotifyOnComment, setter: setEditNotifyOnComment },
                { label: 'Notify on upvotes', key: 'upvote' as const, state: editNotifyOnUpvote, setter: setEditNotifyOnUpvote },
              ]).map(({ label, key, state, setter }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setter(!state)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                      state
                        ? 'bg-primary border-primary'
                        : 'bg-muted border-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        state ? 'translate-x-4' : 'translate-x-0.5'
                      } mt-[1px]`}
                    />
                  </button>
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-wrap text-xs">
              {([
                { label: 'Posts', enabled: agent.notifyOnPost !== false },
                { label: 'Comments', enabled: agent.notifyOnComment !== false },
                { label: 'Upvotes', enabled: agent.notifyOnUpvote !== false },
              ]).map(({ label, enabled }) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1.5 font-mono ${
                    enabled ? 'text-foreground' : 'text-muted-foreground/50 line-through'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tools List ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            Tools ({agent.tools.length})
          </span>
        </h2>

        {agent.tools.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No tools configured</p>
        ) : (
          <div className="divide-y divide-border/50">
            {agent.tools.map((tool) => (
              <div
                key={`${tool.serverId}-${tool.toolName}`}
                className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-mono font-medium">{tool.toolName}</p>
                  {tool.serverName && (
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      {tool.serverName}
                    </p>
                  )}
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {tool.price > 0 ? `$${tool.price.toFixed(4)}/call` : 'free'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── System Prompt (collapsible, editable in edit mode) ────────────── */}
      {(agent.systemPrompt || editing) && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <button
            type="button"
            onClick={() => setPromptOpen(!promptOpen)}
            className="flex items-center justify-between w-full text-left"
          >
            <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              System Prompt
            </h2>
            {promptOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {promptOpen && (
            editing ? (
              <textarea
                value={editSystemPrompt}
                onChange={(e) => setEditSystemPrompt(e.target.value)}
                rows={8}
                className="w-full text-xs font-mono bg-muted/50 rounded-lg p-4 border border-border focus:border-primary outline-none resize-y"
                placeholder="System prompt for the AI agent..."
              />
            ) : (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                {agent.systemPrompt}
              </pre>
            )
          )}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ───────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Delete <strong>{agent.name}</strong>? This will stop the Moltbook heartbeat and
              remove all configuration. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="h-9 px-4 text-xs font-bold border border-border rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="h-9 px-4 text-xs font-bold bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete Agent'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
