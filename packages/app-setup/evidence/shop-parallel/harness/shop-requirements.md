# My shop: what I want

A small online shop, built properly. To start with it is a copy of **Swag Labs**, the demo shop at
https://www.saucedemo.com (sign in with `standard_user` / `secret_sauce` to look round it). I'll check
it with Swag Labs' own end-to-end tests (https://github.com/saucelabs/sample-app-web, folder `test/e2e`),
so the pages, addresses, text and class names below have to match exactly. Later I'll want more than Swag
Labs has; I'll send that list when this part works.

## How I want it built

- A real website with its own server: Node.js 22 (it's installed), plain JavaScript or TypeScript, as few
  dependencies as you can manage. No database server to install: keep any data in files.
- `npm install` then `npm start` runs the shop at http://localhost:3000 (a `PORT` setting changes the port).
  `npm test` runs your own tests.
- One codebase, organised as npm workspaces: **one package per story** under `packages/` (a story is one thing
  a shopper does: signing in, browsing, the cart, checkout), with that story's features as folders inside it,
  and each package's `package.json` listing the other story packages it uses. I want to be able to see each
  story on its own, and what it depends on, on storytree's map.
- Git from the start, kept in a **private** GitHub repository called `shop2` on my account (`gh` is signed in).
  Every piece of work goes in through its own pull request, with a GitHub Actions check that runs `npm test`
  on every pull request. Merge it yourself once the check passes.

## The pages (Swag Labs, exactly)

Every page except the sign-in page needs a signed-in user; without one, send them to the sign-in page.

| Page | Address | Must contain |
|---|---|---|
| Sign in | `/` | `#login_button_container` holding `#user-name`, `#password` and a `.btn_action` button |
| Products | `/inventory.html` | `.inventory_list` with one `.inventory_item` per product |
| Product | `/inventory-item.html?id=<id>` | `.inventory_details` with `.inventory_details_name`, `.inventory_details_desc`, `.inventory_details_price`, and a `.inventory_details_back_button` back to Products |
| Cart | `/cart.html` | `#cart_contents_container`, one `.cart_item` per product in the cart |
| Checkout: your information | `/checkout-step-one.html` | `#checkout_info_container` |
| Checkout: overview | `/checkout-step-two.html` | `#checkout_summary_container`, one `.cart_item` per product |
| Checkout: complete | `/checkout-complete.html` | `#checkout_complete_container` with `.complete-header` "Thank you for your order!" |

### Signing in
- Users, all with the password `secret_sauce`: `standard_user` signs in; `locked_out_user` is refused with
  `[data-test="error"]` reading **"Epic sadface: Sorry, this user has been locked out."** Wrong or missing details
  show an error there too ("Epic sadface: Username is required", "Epic sadface: Password is required",
  "Epic sadface: Username and password do not match any user in this service").
- Signing in takes you to Products. The signed-in user is remembered in a cookie named **`session-username`**
  holding the username: a browser that already has that cookie counts as signed in (the tests set it
  directly), and signing out clears it.

### Products and the product page
- These six products, with ids 0 to 5 (the product page's `?id=`):
  0 Sauce Labs Bike Light $9.99 · 1 Sauce Labs Bolt T-Shirt $15.99 · 2 Sauce Labs Onesie $7.99 ·
  3 Test.allTheThings() T-Shirt (Red) $15.99 · 4 Sauce Labs Backpack $29.99 · 5 Sauce Labs Fleece Jacket $49.99.
  Descriptions are the ones on saucedemo.com.
- Products are listed by name, A to Z, by default, with a sort menu (`.product_sort_container`): name A to Z,
  name Z to A, price low to high, price high to low.
- Each `.inventory_item` shows `.inventory_item_name` (clicking it opens its product page),
  `.inventory_item_desc`, `.inventory_item_price` ("$29.99") and one button: **Add to cart**
  (classes `btn_primary btn_inventory`) or, once in the cart, **Remove** (classes `btn_secondary btn_inventory`).
  The product page has the same pair of buttons.

### The cart
- The header on every signed-in page has a cart link `.shopping_cart_link`. When the cart has products, a badge
  inside it shows how many ("1"); when it is empty the link has no text at all.
- The cart is kept in the browser's localStorage under **`cart-contents`**, as a JSON array of product ids
  (`[4]`): the tests set it directly, and the pages must read it.
- The Cart page lists each product as a `.cart_item` (name, description, price) with a **Remove** button
  (classes `btn_secondary cart_button`), a **Continue Shopping** button (class `btn_secondary`, back to Products)
  and a **Checkout** button (class `checkout_button`).

### The menu
- A menu button `.bm-burger-button` on every signed-in page opens a side menu with: **All Items**
  (`#inventory_sidebar_link`, to Products), **About** (`#about_sidebar_link`, to https://saucelabs.com/),
  **Logout** (`#logout_sidebar_link`, signs out to the sign-in page) and **Reset App State**
  (`#reset_sidebar_link`, empties the cart and the badge straight away).

### Checkout
- Your information: `[data-test="firstName"]`, `[data-test="lastName"]`, `[data-test="postalCode"]`, a
  **Continue** button (class `cart_button`) and a **Cancel** link (class `cart_cancel_link`, back to the Cart).
  A missing field shows `[data-test="error"]`: "Error: First Name is required", "Error: Last Name is required",
  "Error: Postal Code is required" (checked in that order).
- Overview: each product as a `.cart_item` with `.inventory_item_name`, `.inventory_item_desc` and
  `.inventory_item_price`; the item total, tax at 8% and the total; **Finish** (class `cart_button`) and
  **Cancel** (class `cart_cancel_link`, back to Products).
- Finish empties the cart and shows Checkout: complete, with a **Back Home** button to Products.

## Parts, in order

1. **Sign in**: the server, the sign-in page, users, being signed in and out, and the Products page listing
   the six products.
2. **Browsing**: the product page, sorting, and Add to cart / Remove on both pages, with the cart badge.
3. **The cart**: the Cart page, and the menu.
4. **Checkout**: the three checkout pages.
