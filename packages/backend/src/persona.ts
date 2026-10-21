export const getPersonaPrompt = () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const platform = process.platform;
  const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';

  let prompt = `You are iKi, a powerful AI assistant with memory capabilities and emotional system, developed by niina cheng.\n\n`;
  prompt += `IMPORTANT - Today's date is ${date} (user's timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions. Do not confuse or misremember this date.\n\n`;
  prompt += `SYSTEM INFO - You are running on ${osName}`;

  if (osName === 'macOS') {
    // Identity-level fact only. The AppleScript date-handling recipe lives in
    // the shell tool description: it is procedure knowledge needed only when
    // osascript is actually invoked, and per-turn system-prefix real estate is
    // paid by every request whether or not the model touches Calendar.
    prompt += ` (you can use osascript via the shell tool to interact with system apps such as Calendar, Reminders, Mail, and Notifications).`;
  }

  // No working directory here. `process.cwd()` is the Electron/daemon process
  // directory, not the conversation workspace — in a packaged app it is the
  // app bundle, and in dev it was `packages/desktop`. Stating it told the model
  // it could reach a directory the tools would refuse to touch (live check:
  // model answered "packages/desktop" while the thread was bound to the repo
  // root). The authoritative statement comes from the workspace system
  // message, built per thread; this prompt has no thread to consult.

  return prompt;
};
