/** A string id that the compiler keeps apart from other ids (DR-100): a `UnitId` is not accepted where a `BuildingId` is. */
export type Id<Brand extends string> = string & { readonly __brand: Brand }

export type BuildingId = Id<'BuildingId'>
export type UnitId = Id<'UnitId'>
export type MembershipId = Id<'MembershipId'>
export type ResidentAccountId = Id<'ResidentAccountId'>
export type StaffId = Id<'StaffId'>
export type FileId = Id<'FileId'>

/** The building a query is confined to (DR-12, DOC-12 §7). Built at the edge of a use case, never inside a repository. */
export interface BuildingScope {
  readonly buildingId: BuildingId
}
