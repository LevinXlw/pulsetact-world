// Copy to auth-credentials.mjs and set the password on the development/release
// machine. The real file is ignored by Git and must never enter public/ or src/.
const password = 'REPLACE_WITH_A_RANDOM_PASSWORD';
if (password === 'REPLACE_WITH_A_RANDOM_PASSWORD') {
  throw new Error('Set a fixed-account password in server/auth-credentials.mjs before starting or publishing.');
}
export const FIXED_ACCOUNT = Object.freeze({ username: 'tony', password });
