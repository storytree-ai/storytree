// Capability 1 · Project routing
interface Reads {
  user(): Buffer;
  descriptor(file: string): Buffer;
}
let native: Reads | undefined;

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
      if (!openProcessToken(currentProcess(), 0x0008, token)) throw new Error("OpenProcessToken");
      try {
        const info = Buffer.alloc(256);
        if (!tokenInformation(token[0], 1, info, info.length, [0])) throw new Error("GetTokenInformation");
        const sid = koffi.decode(info, "void *");
        return Buffer.from(new Uint8Array(koffi.view(sid, sidLength(sid))));
      } finally { closeHandle(token[0]); }
    },
    descriptor(file) {
      const descriptor = Buffer.alloc(65_536);
      if (!fileSecurity(file, 7, descriptor, descriptor.length, [0])) throw new Error("GetFileSecurityW");
      return descriptor;
    },
  };
  return native;
}

export const windowsSecurity: Reads = {
  user: () => load().user(),
  descriptor: (file) => load().descriptor(file),
};
