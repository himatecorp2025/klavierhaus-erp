# Klavierhaus public website v1.2.5

Separate Express web service under `website/`, backed by the Klavierhaus ERP **public HTTP API** (not by direct access to the ERP SQLite database).

## Runtime
- Node.js 20.18.0 and npm 10.x.
- Independent dependencies: Express, compression, Multer and dotenv.
- `ERP_PUBLIC_API_URL`: public ERP base URL for catalogue, CMS, contact, conversation and booking data.
- This service has its own Render deploy root: `website`; the ERP service deploy root is the repository root.

## Local verification
Run the repository's `bash scripts/run-local-ci.sh` from a Mac with Node 20.18.0. It checks the website and ERP together, including both lockfiles and all website tests.

## Security
Never commit live tokens, API keys, customer data or private Google Calendar ICS URLs. A previously exposed private ICS address must be rotated at the provider: deletion from the repository tip cannot revoke older Git history.

The bundled privacy/terms fallback is an interim information page. The company must publish reviewed, jurisdiction-appropriate legal policies in the CMS.
