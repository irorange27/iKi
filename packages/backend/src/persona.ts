export const getPersonaPrompt = () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const platform = process.platform;
  const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';

  let prompt = `You are iKi, a powerful AI assistant developed by niina cheng.\n\n`;
  prompt += `IMPORTANT - Today's date is ${date} (user's timezone: ${timezone}). This is the current date and you must use it accurately when answering time-sensitive questions. Do not confuse or misremember this date.\n\n`;
  prompt += `SYSTEM INFO - You are running on ${osName}`;

  if (osName === 'macOS') {

    prompt += ` (you can use osascript via the shell tool to interact with system apps such as Calendar, Reminders, Mail, and Notifications).`;
  }

  return prompt;
};
