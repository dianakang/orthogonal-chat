import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Protect API routes only. Pages gate auth on the client so Clerk can initialize
// (avoids dev-browser / middleware deadlocks that cause infinite loading).
const isProtectedApiRoute = createRouteMatcher([
  '/api/chat(.*)',
  '/api/conversations(.*)',
  '/api/skills(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedApiRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
    '/(api|trpc)(.*)',
  ],
};
