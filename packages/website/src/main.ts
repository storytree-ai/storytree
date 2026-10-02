import { wireWaitlist } from "./waitlist.js";
import { wireOpening } from "./opening.js";

wireOpening();
const form = document.querySelector<HTMLFormElement>("#waitlist-form");
if (form) wireWaitlist(form);
