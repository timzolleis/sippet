// Tags, collections, and smart collections are one per name, ignoring case (library rules 3, 9).
export const libraryNameKey = (name: string): string => name.toLowerCase()

export const isSameLibraryName = (a: string, b: string): boolean => libraryNameKey(a) === libraryNameKey(b)
