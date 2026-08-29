// Loader hook: redirect firebase-admin imports to the in-memory mocks so the
// migration CLI can be exercised end-to-end without a Firebase project.
// Registered via register-hooks.mjs (node --import).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'firebase-admin/app' || specifier === 'firebase-admin/firestore') {
    const file = new URL(`./firebase-admin/${specifier.split('/')[1]}.mjs`, import.meta.url);
    return { url: file.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
