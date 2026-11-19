// Match a complete retired namespace, not similarly named panel or license routes.
export function isRemovedShopPath(pathname) {
  return /^\/(?:api\/panel\/crag-shop|crag-purchase|crag-preview|shop)(?:\/|$)/.test(pathname)
}
