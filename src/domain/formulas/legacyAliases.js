export function defineLegacyAliasContract(aliases = {}, transforms = {}) {
  const legacyAliases = Object.freeze({ ...aliases })
  const legacyAliasMetadata = Object.freeze(
    Object.fromEntries(
      Object.entries(legacyAliases).map(([legacyName, legacyAliasOf]) => [
        legacyName,
        Object.freeze({
          deprecated: true,
          legacyAliasOf,
          ...(transforms[legacyName] ? { transform: transforms[legacyName] } : {}),
        }),
      ]),
    ),
  )
  return Object.freeze({ legacyAliases, legacyAliasMetadata })
}
