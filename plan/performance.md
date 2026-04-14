## Encryptio / decryption

Public key cryptography uses secp256k1 curve to be compatible with Nostr. It is not WebCrypto supported, and current JS implementation is 50–100x slower than native implementation. If encryption starts to slow app down, the fix is to (1.) move en/decoding to WebWorkers and (2.) use WASM compiled library:

  A well-optimized WASM secp256k1 implementation would be within 1.5–3x of native Web Crypto speed — so the gap shrinks from 50–100x to nearly negligible.

  libsecp256k1 compiled to WASM is the go-to choice — it's the same C library Bitcoin Core uses, with constant-time field arithmetic and hand-tuned assembly-level optimizations. The WASM overhead is mostly just the indirect function call boundary and slightly less aggressive SIMD usage compared to native.

  Combined with a Web Worker, you'd get both benefits: near-native speed and off the main thread.