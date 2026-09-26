// Chromium still probes /dev/dri during startup with --disable-gpu. On this box that
// blocks forever in drm_open because the GPU fell off the bus. Deny hardware device
// opens in this browser process only; SwiftShader needs none of them. No system change.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <string.h>

static int blocked(const char *path) {
  return path && (!strncmp(path, "/dev/dri/", 9) || !strncmp(path, "/dev/nvidia", 11));
}
#define WRAP_OPEN(name) \
int name(const char *path, int flags, ...) { \
  if (blocked(path)) { errno = ENODEV; return -1; } \
  mode_t mode = 0; \
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { \
    va_list args; va_start(args, flags); mode = va_arg(args, int); va_end(args); \
  } \
  int (*real)(const char *, int, ...) = dlsym(RTLD_NEXT, #name); \
  return real(path, flags, mode); \
}
#define WRAP_OPENAT(name) \
int name(int dirfd, const char *path, int flags, ...) { \
  if (blocked(path)) { errno = ENODEV; return -1; } \
  mode_t mode = 0; \
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { \
    va_list args; va_start(args, flags); mode = va_arg(args, int); va_end(args); \
  } \
  int (*real)(int, const char *, int, ...) = dlsym(RTLD_NEXT, #name); \
  return real(dirfd, path, flags, mode); \
}
WRAP_OPEN(open)
WRAP_OPEN(open64)
WRAP_OPENAT(openat)
WRAP_OPENAT(openat64)
