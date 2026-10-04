# My shop, part two: more than Swag Labs

The Swag Labs copy works, thanks. Now I want a proper shop. Everything in the first list
(`shop-requirements.md`) still holds and must keep working exactly as it does: I'll keep running Swag Labs'
tests, and I'll check the new things with tests of my own against what's written here, so the addresses,
`data-test` names and wording below have to match.

Same as before: the shop's own server, data kept in files (nothing to install), one package per story
with its `package.json` naming the other stories it uses, `npm start` on port 3000 (`PORT` overrides), every piece
of work through its own pull request with the check passing before you merge it.

New data must survive a restart of the server. Anything that changes data goes through the server; the
browser only keeps what Swag Labs already keeps there (the `session-username` cookie and the `cart-contents`
list).

## Parts, in order

### 5. Accounts: anyone can sign up
- A **Sign up** link on the sign-in page (`[data-test="signup-link"]`) goes to `/signup.html`, a form with
  `[data-test="signup-name"]` (full name), `[data-test="signup-username"]`, `[data-test="signup-password"]`
  and a `[data-test="signup-submit"]` button.
- Rules, shown in `[data-test="error"]` when broken, checked in this order:
  "Error: Name is required", "Error: Username is required", "Error: Password must be at least 8 characters",
  "Error: That username is taken" (the Swag Labs users count as taken).
- Signing up signs the new user in and takes them to Products. They can sign out and sign in again with the
  sign-in page as before.
- Every signed-in page's header shows `[data-test="greeting"]` reading "Hi, <full name>" (for the Swag Labs
  users, their username).
- `GET /api/me` answers the signed-in user as `{"username": …, "name": …}`, or 401 when nobody is signed in.

### 6. Orders: what I've bought
- Finish (checkout) now saves the order on the server for the signed-in user: its products with their prices
  then, the item total, tax and total, the name and postal code given, and when it was placed. Each order gets
  a number, counting up from 1001 across the shop. The complete page shows `[data-test="order-number"]` with
  it ("Order #1001").
- A **My Orders** link in the side menu (`#orders_sidebar_link`) goes to `/orders.html`: one
  `[data-test="order-row"]` per order of this user, newest first, each showing its number, date, item count and
  total, linking to `/order.html?id=<number>`.
- `/order.html?id=<number>` shows that order: one `.cart_item` per product (`.inventory_item_name`,
  `.inventory_item_price`) and `[data-test="order-total"]` ("Total: $32.39"). Another user's order, or one that
  doesn't exist, shows `[data-test="error"]` "Error: Order not found".
- With no orders, `/orders.html` shows `[data-test="no-orders"]` "You haven't ordered anything yet."

### 7. Search
- Products has a search box `[data-test="search"]`. Typing filters the list as you type, matching product
  names and descriptions, ignoring case. The address keeps it (`/inventory.html?q=backpack`), so a search can
  be shared and survives a reload.
- No match shows `[data-test="no-results"]` "No products match “<what was typed>”." and no `.inventory_item`.
- Sorting still works on the filtered list. The sort menu's options have Swag Labs' values: `az`, `za`, `lohi`,
  `hilo`.

### 8. Reviews
- Each product page shows its reviews under the product: `[data-test="review"]` each, with the reviewer's name,
  1 to 5 stars and the text, newest first; and `[data-test="rating"]` with the average to one decimal and the
  count ("4.5 (2 reviews)"), or "No reviews yet".
- Products shows each product's `[data-test="rating"]` too, the same wording.
- Only someone who has ordered the product can review it, once. They see a form: `[data-test="review-stars"]`
  (a select, 1 to 5), `[data-test="review-text"]` and `[data-test="review-submit"]`. Text is required:
  "Error: Please write a review". Anyone else sees `[data-test="review-locked"]` "Only customers who bought this
  can review it." and someone who has reviewed it sees `[data-test="review-done"]` "Thanks for your review!"

### 9. Stock and an admin
- Each product has stock. To start with every product has 10.
- A product's page and its `.inventory_item` show `[data-test="stock"]`: "In stock" from 6 up, "Only <n> left"
  from 5 down to 1, "Sold out" at 0. A sold-out product's Add to cart button is disabled.
- Finishing an order takes its products off stock (one each). If something in the cart sold out meanwhile,
  Finish refuses with `[data-test="error"]` "Error: <product name> is sold out" and keeps the cart.
- A new user `admin_user` (password `secret_sauce`) has an **Admin** link in the side menu
  (`#admin_sidebar_link`) to `/admin.html`; nobody else sees the link, and `/admin.html` sends anyone else to
  Products. Admin lists every product as `[data-test="admin-row"]` with `[data-test="admin-price"]` and
  `[data-test="admin-stock"]` inputs and a `[data-test="admin-save"]` button per row; saving shows
  `[data-test="admin-saved"]` "Saved" and the shop shows the new price and stock straight away.
- Prices from then on are the admin's: the cart, checkout and new orders use them; orders already placed keep
  the prices they were bought at.
