/** Capability 1 · Project routing. Windows' own security calls, made in this process for the handoff's privacy check (contract 1.16). */
interface Reads {
  /** The SID this process runs as, from its own token. */
  user(): Buffer;
  /** A file's or folder's self-relative security descriptor: owner, group and DACL. */
  descriptor(file: string): Buffer;
}
let native: Reads | undefined;

// Koffi is resolved from where this code runs (a release bundle stages it beside itself), only
// when a Windows check first needs it, so no other platform loads it and no bundler inlines it. Node's
// module helper is fetched, not imported: a bundle's banner may already declare createRequire.
function load(): Reads {
  if (native) return native;
  const require = process.getBuiltinModule("node:module").createRequire(typeof __filename === "string" ? __filename : import.meta.url);
  const koffi = require("koffi") as typeof import("koffi");
  const kernel = koffi.load("kernel32.dll");
  const advapi = koffi.load("advapi32.dll");
  const currentProcess = kernel.func("void * __stdcall GetCurrentProcess()");
  const closeHandle = kernel.func("int __stdcall CloseHandle(void *handle)");
  const openProcessToken = advapi.func("int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ void **token)");
  const tokenInformation = advapi.func("int __stdcall GetTokenInformation(void *token, int infoClass, _Out_ void *info, uint32_t length, _Out_ uint32_t *returned)");
  const sidLength = advapi.func("uint32_t __stdcall GetLengthSid(void *sid)");
  const fileSecurity = advapi.func("int __stdcall GetFileSecurityW(const char16_t *file, uint32_t requested, _Out_ void *descriptor, uint32_t length, _Out_ uint32_t *needed)");
  native = {
    user() {
      const token: unknown[] = [null];
      if (!openProcessToken(currentProcess(), 0x0008 /* TOKEN_QUERY */, token)) throw new Error("OpenProcessToken");
      try {
        // TOKEN_USER points at the user's SID, which the call places later in the same buffer.
        const info = Buffer.alloc(256);
        if (!tokenInformation(token[0], 1 /* TokenUser */, info, info.length, [0])) throw new Error("GetTokenInformation");
        const sid = koffi.decode(info, "void *");
        return Buffer.from(new Uint8Array(koffi.view(sid, sidLength(sid))));
      } finally { closeHandle(token[0]); }
    },
    descriptor(file) {
      // Owner, group and DACL (7). An ACL's size is a 16-bit count, so 64 KiB holds any descriptor.
      const descriptor = Buffer.alloc(65_536);
      if (!fileSecurity(file, 7, descriptor, descriptor.length, [0])) throw new Error("GetFileSecurityW");
      return descriptor;
    },
  };
  return native;
}

/** The reads a check makes; tests stand in for them where Windows is not the host. */
export const windowsSecurity: Reads = {
  user: () => load().user(),
  descriptor: (file) => load().descriptor(file),
};
