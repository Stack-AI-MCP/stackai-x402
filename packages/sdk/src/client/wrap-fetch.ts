// Thin re-export of x402-stacks axios payment wrapper
export { wrapAxiosWithPayment as wrapAxios, wrapAxiosWithPayment } from 'x402-stacks'
export { decodePaymentRequired, decodePaymentResponse } from 'x402-stacks'
export type { AxiosInstance as AxiosLike } from 'axios'
