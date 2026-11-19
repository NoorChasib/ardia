import { nativeModule } from "@nilla/shell";

const Keychain = nativeModule("NillaKeychain");

export const keychainGet = (account: string) => Keychain.get(account);
export const keychainSet = (account: string, secret: string) => Keychain.set(account, secret);
export const keychainDelete = (account: string) => Keychain.delete(account);
