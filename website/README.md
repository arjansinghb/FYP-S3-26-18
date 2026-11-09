# Project website

The project's public website is the landing page of the web app itself, so there is no separate
code in this folder. It is live at:

**https://fyp-pip-frontend.vercel.app**

It introduces Pip, explains how it works and why it is safe, shows the Free and Premium plans, shows
reviews written by parents, and links to sign-up.

Source: `src/frontend/src/pages/Home.jsx` and `src/frontend/src/pages/landing.css`. The text, plans and
reviews come from the backend (`/api/public/site`, `/api/public/plans`, `/api/public/reviews`), so an
admin can change them in the admin console without a new deployment.
