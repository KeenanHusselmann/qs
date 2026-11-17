/**
 * The id of the column beside `<main>` that the assistant panels render into.
 *
 * Its own module, with no "use client", because the server layout renders the element and the client
 * panel finds it: a constant exported from a client module reaches a server component as a client
 * reference, not as the string.
 */
export const ASSISTANT_SLOT_ID = "assistant-slot";
