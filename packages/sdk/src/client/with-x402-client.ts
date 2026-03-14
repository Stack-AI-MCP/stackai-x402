import { privateKeyToAccount, wrapAxiosWithPayment } from 'x402-stacks'
import axios from 'axios'
import type { AxiosInstance } from 'axios'

/**
 * Creates an axios instance pre-wired with automatic x402 V2 payment handling.
 *
 * When a 402 is returned with a `payment-required` header, the interceptor:
 * 1. Decodes the `PaymentRequiredV2` (accepts array)
 * 2. Signs a transaction for the first compatible Stacks option
 * 3. Retries with `payment-signature: base64(PaymentPayloadV2)`
 *
 * The private key signs transactions locally — it is NEVER sent over the wire.
 */
export function createAgentClient(
  privateKey: string,
  network: 'mainnet' | 'testnet',
): AxiosInstance {
  const account = privateKeyToAccount(privateKey, network)
  return wrapAxiosWithPayment(axios.create(), account)
}
