/// <reference types="vite/client" />

// Set this public build variable only after the support inbox can receive mail.
const address = import.meta.env.VITE_SUPPORT_EMAIL?.trim();

export function SupportContact() {
  if (!address || !/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(address)) return null;
  return <a href={`mailto:${address}`}>Email support</a>;
}
