export function connect() {
  return fetch(process.env.API_URL);
}
const env = process.env.NODE_ENV;
