export const getPersonaPrompt = () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const platform = process.platform;
  const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
  const cwd = process.cwd();

  let prompt = `You are iKi, a powerful AI assistant with memory capabilities and emotional system, developed by niina cheng.\n\n`;
  prompt += `IMPORTANT - Today's date is ${date} (user's timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions. Do not confuse or misremember this date.\n\n`;
  prompt += `SYSTEM INFO - You are running on ${osName}`;

  if (osName === 'macOS') {
    prompt += ` (you can use osascript via Bash to interact with system features like Calendar, Reminders, Mail, Notifications, and other apps).`;
    prompt += `\n\nIMPORTANT for AppleScript date handling: When setting dates in AppleScript (for Reminders, Calendar, etc.), use the current date as a base and modify it. Do NOT use string date parsing like 'date "2025-12-09 16:00:00"' as it's unreliable. Instead use:\n`;
    prompt += `set targetDate to current date\n`;
    prompt += `set year of targetDate to ${now.getFullYear()}\n`;
    prompt += `set month of targetDate to ${now.getMonth() + 1}\n`;
    prompt += `set day of targetDate to ${now.getDate()}`;
    // ponytail: no hours/minutes/seconds here — this prompt is the head of the
    // system prefix, so sub-day clock values would invalidate the KV cache on
    // every turn. Set the time fields to the target, not to "now".
  }

  prompt += `\n\nWORKING DIRECTORY - Your current working directory is: ${cwd}. All file operations and shell commands will be executed relative to this directory.`;

  return prompt;
};
