const APP_MODULE = /^Nilla[A-Z]/;

export const engineModuleName = (name: string) => (APP_MODULE.test(name) ? `Ardia${name.slice(5)}` : name);

export function engineCallName(name: string) {
  const dot = name.indexOf(".");
  return dot < 0 ? engineModuleName(name) : `${engineModuleName(name.slice(0, dot))}${name.slice(dot)}`;
}
