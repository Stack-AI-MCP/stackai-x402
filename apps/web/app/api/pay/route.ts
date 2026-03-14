const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

export async function POST(request: Request) {
  const body = await request.json()
  const { serverId, toolName, args, paymentSignature } = body

  if (!serverId || !toolName || !paymentSignature) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (typeof paymentSignature !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Invalid payment signature' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // paymentSignature is already base64(JSON(PaymentPayloadV2)) — forward directly
  const proxyRes = await fetch(`${GATEWAY_URL}/api/v1/proxy/${serverId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      'payment-signature': paymentSignature,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: toolName,
      params: args,
    }),
  })

  // Extract payment-response header (V2: base64 JSON with success, transaction, payer, network)
  const paymentResponseHeader = proxyRes.headers.get('payment-response')
  let txid: string | undefined
  if (paymentResponseHeader) {
    try {
      const settlement = JSON.parse(
        Buffer.from(paymentResponseHeader, 'base64').toString('utf-8'),
      ) as { transaction?: string }
      txid = settlement.transaction
    } catch {
      // ignore parse errors
    }
  }

  if (!proxyRes.ok) {
    const errBody = await proxyRes.json().catch(() => ({}))
    return new Response(
      JSON.stringify({
        error: errBody.error ?? `Payment failed (${proxyRes.status})`,
        code: errBody.code,
        txid,
      }),
      { status: proxyRes.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const toolResult = await proxyRes.json()
  return new Response(
    JSON.stringify({ txid, toolResult }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
