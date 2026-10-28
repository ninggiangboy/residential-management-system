/**
 * `analytics` is a leaf (DOC-104 §6): no module calls it and it calls none but `building`, to ask whether a building is a demo
 * one. Its contract is empty on purpose; the file exists because every module exports `./contracts` (DOC-12 §4.4).
 */
export {}
