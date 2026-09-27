# Security policy

Report vulnerabilities privately through GitHub's **Security → Report a
vulnerability** for this repository:

https://github.com/zucchini-wallet/dapp-sdk/security/advisories/new

Include affected package/version, a minimal reproduction using public fixtures,
expected behavior, and impact. Never attach wallet seeds, spending/viewing keys,
production credentials or customer payment data. Do not submit exploit details
as a public issue while coordinating a fix.

Security fixes target the latest dApp SDK and scanner SDK releases. Older versions
are not guaranteed backports; migration requirements are documented in release
notes. There is no guaranteed response time or funded bug-bounty program implied
by this policy.

The browser SDK requests wallet approvals; it does not custody keys or funds.
The scanner holds incoming viewing authority locally and depends on its lightwallet
provider for canonical-chain information. Its batch API does not authorize order
fulfillment. Experimental merchant APIs and public fixture keys must not be treated
as production merchant trust infrastructure.
