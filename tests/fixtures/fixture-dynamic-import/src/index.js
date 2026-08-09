export async function loadPage(name) {
  const mod = await import(`./pages/${name}.js`);
  return mod;
}
