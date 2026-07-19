import { createDatabase } from "./database.js";

const db = createDatabase();
export { db };

export * from "./database.js";
