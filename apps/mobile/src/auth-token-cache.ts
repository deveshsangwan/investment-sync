import * as SecureStore from "expo-secure-store";
import { tryCatch } from "@investment-sync/result";

export const tokenCache = {
  async getToken(key: string) {
    const result = await tryCatch(SecureStore.getItemAsync(key));
    return result.ok ? result.data : null;
  },
  async saveToken(key: string, value: string) {
    await SecureStore.setItemAsync(key, value);
  },
};
