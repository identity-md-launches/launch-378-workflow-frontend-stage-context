import "@testing-library/jest-dom/vitest";

// jsdom supplies its own AbortSignal while Node's fetch/Request come from undici, which rejects
// a foreign signal. Tests stub fetch anyway, so drop the signal when Request objects are built.
const OriginalRequest = globalThis.Request;
class TestRequest extends OriginalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init);
  }
}
globalThis.Request = TestRequest as typeof Request;
