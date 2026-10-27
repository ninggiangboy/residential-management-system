/** The key ids of the sealed CCCD numbers in use (DOC-36 §10.1 check 6). */
export interface PiiKeyReader {
  keyIds(): Promise<string[]>
}
