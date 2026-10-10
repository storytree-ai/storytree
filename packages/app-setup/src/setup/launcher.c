/*
 * The `storytree` command on Windows (ADR-0854). A batch file cannot carry a word as written: Windows
 * runs one through cmd.exe, which parses the caller's whole command line before the batch's first
 * line, so a > after an inner double quote writes a file and an & starts a command. This program
 * runs no shell. It hands the caller's command line, after its own name, unchanged to the Node and
 * the script named in the text appended to its file, waits, and exits with the script's exit code. It
 * also passes that line on in STORYTREE_COMMAND_LINE, so the command can tell a word its caller's own
 * quoting changed, as Windows PowerShell 5.1's does (ADR-0856).
 *
 * The appended text is UTF-8: three lines, each ended by a line feed (the marker that says the file
 * is storytree's, then Node, then the script), followed by its length in four little-endian bytes
 * and "stlr". command.ts writes it.
 *
 * Built with LLVM alone (../bins/launcher.ts): no C library and no Windows SDK, so the few kernel32
 * calls are declared here, each on a line of its own starting IMPORT, which the build reads.
 */
typedef void *HANDLE;
typedef int BOOL;
typedef unsigned long DWORD;
typedef unsigned short WORD;
typedef unsigned char BYTE;
typedef unsigned short WCHAR;
typedef unsigned long long SIZE_T;
typedef long long LONGLONG;

typedef struct {
  DWORD cb;
  WCHAR *lpReserved, *lpDesktop, *lpTitle;
  DWORD dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
  WORD wShowWindow, cbReserved2;
  BYTE *lpReserved2;
  HANDLE hStdInput, hStdOutput, hStdError;
} STARTUPINFOW;
typedef struct {
  HANDLE hProcess, hThread;
  DWORD dwProcessId, dwThreadId;
} PROCESS_INFORMATION;
typedef BOOL (*CONTROL_HANDLER)(DWORD event);

#define IMPORT __declspec(dllimport)
#define INVALID_HANDLE_VALUE ((HANDLE)(LONGLONG)-1)
#define STD_ERROR_HANDLE ((DWORD)-12)
#define GENERIC_READ 0x80000000UL
#define SHARE_ALL 0x7UL
#define OPEN_EXISTING 3UL
#define CP_UTF8 65001U
#define MB_ERR_INVALID_CHARS 0x8UL
#define INFINITE 0xFFFFFFFFUL
#define LONGEST_LINE 32767

IMPORT HANDLE GetProcessHeap(void);
IMPORT void *HeapAlloc(HANDLE heap, DWORD flags, SIZE_T bytes);
IMPORT DWORD GetModuleFileNameW(HANDLE module, WCHAR *name, DWORD size);
IMPORT HANDLE CreateFileW(const WCHAR *name, DWORD access, DWORD share, void *security, DWORD disposition, DWORD flags, HANDLE model);
IMPORT BOOL GetFileSizeEx(HANDLE file, LONGLONG *size);
IMPORT BOOL SetFilePointerEx(HANDLE file, LONGLONG distance, LONGLONG *at, DWORD method);
IMPORT BOOL ReadFile(HANDLE file, void *buffer, DWORD bytes, DWORD *read, void *overlapped);
IMPORT BOOL WriteFile(HANDLE file, const void *buffer, DWORD bytes, DWORD *written, void *overlapped);
IMPORT BOOL CloseHandle(HANDLE handle);
IMPORT int MultiByteToWideChar(unsigned page, DWORD flags, const char *text, int bytes, WCHAR *wide, int size);
IMPORT int WideCharToMultiByte(unsigned page, DWORD flags, const WCHAR *wide, int size, char *text, int bytes, const char *fallback, BOOL *used);
IMPORT WCHAR *GetCommandLineW(void);
IMPORT int lstrlenW(const WCHAR *text);
IMPORT HANDLE GetStdHandle(DWORD which);
IMPORT BOOL GetConsoleMode(HANDLE console, DWORD *mode);
IMPORT BOOL WriteConsoleW(HANDLE console, const WCHAR *text, DWORD length, DWORD *written, void *reserved);
IMPORT void GetStartupInfoW(STARTUPINFOW *startup);
IMPORT BOOL SetConsoleCtrlHandler(CONTROL_HANDLER handler, BOOL add);
IMPORT BOOL CreateProcessW(const WCHAR *program, WCHAR *line, void *processSecurity, void *threadSecurity, BOOL inherit, DWORD flags, void *environment, const WCHAR *folder, STARTUPINFOW *startup, PROCESS_INFORMATION *process);
IMPORT DWORD WaitForSingleObject(HANDLE handle, DWORD milliseconds);
IMPORT BOOL GetExitCodeProcess(HANDLE process, DWORD *code);
IMPORT BOOL SetEnvironmentVariableW(const WCHAR *name, const WCHAR *value);
IMPORT void ExitProcess(unsigned code) __attribute__((noreturn));

/* Text for the person at the terminal: as characters to a console, as UTF-8 to a file or a pipe. */
static void say(const WCHAR *text) {
  HANDLE error = GetStdHandle(STD_ERROR_HANDLE);
  DWORD mode, written;
  int length = lstrlenW(text);
  if (GetConsoleMode(error, &mode)) {
    WriteConsoleW(error, text, (DWORD)length, &written, 0);
    return;
  }
  char bytes[1024];
  int size = WideCharToMultiByte(CP_UTF8, 0, text, length, bytes, sizeof bytes, 0, 0);
  if (size > 0) WriteFile(error, bytes, (DWORD)size, &written, 0);
}

static __attribute__((noreturn)) void fail(const WCHAR *why, const WCHAR *detail) {
  say(L"storytree: ");
  say(why);
  if (detail != 0) {
    say(L" ");
    say(detail);
  }
  say(L"\r\nRun the storytree installer again to repair this command.\r\n");
  ExitProcess(1);
}

/* Ctrl+C and Ctrl+Break reach the script as well, which decides what they mean; this program waits for it. */
static BOOL waitForScript(DWORD event) { return event == 0 || event == 1; }

/* Where the caller's words start: after this program's own name, which Windows reads with no escapes. */
static const WCHAR *afterOwnName(const WCHAR *line) {
  BOOL quoted = 0;
  for (; *line != 0; line++) {
    if (*line == L'"') quoted = !quoted;
    else if (!quoted && (*line == L' ' || *line == L'\t')) break;
  }
  while (*line == L' ' || *line == L'\t') line++;
  return line;
}

static WCHAR *append(WCHAR *end, const WCHAR *text) {
  while (*text != 0) *end++ = *text++;
  return end;
}

void start(void) {
  HANDLE heap = GetProcessHeap();
  WCHAR *self = HeapAlloc(heap, 0, LONGEST_LINE * sizeof(WCHAR));
  if (self == 0 || GetModuleFileNameW(0, self, LONGEST_LINE) == 0) fail(L"this command cannot find its own file.", 0);

  /* The appended text, read back from the end of this program's own file. */
  HANDLE file = CreateFileW(self, GENERIC_READ, SHARE_ALL, 0, OPEN_EXISTING, 0, 0);
  LONGLONG size = 0;
  BYTE trailer[8];
  DWORD read = 0;
  if (file == INVALID_HANDLE_VALUE || !GetFileSizeEx(file, &size) || size < 8) fail(L"this command's file cannot be read:", self);
  if (!SetFilePointerEx(file, size - 8, 0, 0) || !ReadFile(file, trailer, 8, &read, 0) || read != 8
      || trailer[4] != 's' || trailer[5] != 't' || trailer[6] != 'l' || trailer[7] != 'r') {
    fail(L"this command does not say which storytree it runs:", self);
  }
  DWORD length = (DWORD)trailer[0] | (DWORD)trailer[1] << 8 | (DWORD)trailer[2] << 16 | (DWORD)trailer[3] << 24;
  if (length == 0 || length > 65536 || (LONGLONG)length > size - 8) fail(L"this command does not say which storytree it runs:", self);
  char *text = HeapAlloc(heap, 0, length);
  if (text == 0 || !SetFilePointerEx(file, size - 8 - (LONGLONG)length, 0, 0) || !ReadFile(file, text, length, &read, 0) || read != length) {
    fail(L"this command's file cannot be read:", self);
  }
  CloseHandle(file);

  int wide = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, 0, 0);
  WCHAR *named = wide > 0 ? HeapAlloc(heap, 0, ((SIZE_T)wide + 1) * sizeof(WCHAR)) : 0;
  if (named == 0 || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, named, wide) != wide) {
    fail(L"this command does not say which storytree it runs:", self);
  }
  named[wide] = 0;
  /* The marker, Node, the script. */
  WCHAR *lines[3] = { named, 0, 0 };
  int ended = 0;
  for (WCHAR *at = named; *at != 0; at++) {
    if (*at != L'\n') continue;
    *at = 0;
    if (++ended < 3) lines[ended] = at + 1;
  }
  if (ended != 3 || lines[1][0] == 0 || lines[2][0] == 0) fail(L"this command does not say which storytree it runs:", self);
  const WCHAR *node = lines[1];
  const WCHAR *script = lines[2];

  /* "Node" "the script" and then the caller's words, exactly as the caller's line spelled them. */
  const WCHAR *words = afterOwnName(GetCommandLineW());
  int total = lstrlenW(node) + lstrlenW(script) + lstrlenW(words) + 7;
  if (total > LONGEST_LINE) fail(L"the command line is longer than Windows allows.", 0);
  WCHAR *line = HeapAlloc(heap, 0, (SIZE_T)total * sizeof(WCHAR));
  if (line == 0) fail(L"there is not enough memory to start.", 0);
  WCHAR *end = append(append(append(append(append(line, L"\""), node), L"\" \""), script), L"\"");
  if (*words != 0) end = append(append(end, L" "), words);
  *end = 0;

  /* The caller's own start-up information: its standard handles, and any further ones Node passes on. */
  STARTUPINFOW startup;
  GetStartupInfoW(&startup);
  PROCESS_INFORMATION process;
  SetEnvironmentVariableW(L"STORYTREE_COMMAND_LINE", words);
  SetConsoleCtrlHandler(waitForScript, 1);
  if (!CreateProcessW(node, line, 0, 0, 1, 0, 0, 0, &startup, &process)) fail(L"Node could not start:", node);
  CloseHandle(process.hThread);
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(process.hProcess, &code);
  ExitProcess(code);
}
