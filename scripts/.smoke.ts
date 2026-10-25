import { signInLocalCook } from "./local-cook.ts"
const cook = await signInLocalCook()
const dev = async (op: string, args: unknown = {}) => {
  const res = await fetch(`http://localhost:1337/api/dev/${op}`, { method: "POST", headers: { authorization: `Bearer ${cook.token}`, "content-type": "application/json" }, body: JSON.stringify(args) })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return `${res.status} ${text.slice(0, 500)}` }
}
console.log(await dev("counts"))
console.log(JSON.stringify(await dev("sql", { statement: "select name from sqlite_master where type='table' order by 1" })))
