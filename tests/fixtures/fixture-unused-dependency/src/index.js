import { get } from "axios";

export async function load() {
  return get("/api");
}
