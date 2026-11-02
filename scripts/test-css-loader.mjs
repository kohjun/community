// CSS layout is exercised in browser checks; Node SSR tests need class-name exports only.
export async function load(url, context, nextLoad) {
  if (url.endsWith(".module.css")) return {format:"module",shortCircuit:true,source:'export default new Proxy({}, {get:(_,name)=>typeof name === "string" ? name : undefined});'};
  return nextLoad(url, context);
}
