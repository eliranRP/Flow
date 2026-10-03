import type { Database as GeneratedDatabase } from "./database.types.ts";

type SumitConnection = GeneratedDatabase["public"]["Views"]["sumit_connections"];

/** Columns the browser role is not granted. They stay in the generated file. */
type SecretColumn =
  | "key_ciphertext"
  | "key_nonce"
  | "dek_ciphertext"
  | "dek_nonce"
  | "kek_version"
  | "envelope_version";

type PublicSumitConnection = {
  Row: Omit<SumitConnection["Row"], SecretColumn>;
  Insert: Omit<SumitConnection["Insert"], SecretColumn>;
  Update: Omit<SumitConnection["Update"], SecretColumn>;
  Relationships: SumitConnection["Relationships"];
};

/**
 * Client database type. `sumit_connections` matches the columns authenticated
 * may read. The generated file is untouched CLI output.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: Omit<GeneratedDatabase["public"]["Tables"], "sumit_connections"> & {
      sumit_connections: PublicSumitConnection;
    };
  };
};
