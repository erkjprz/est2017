"use client"

import { useEffect, useMemo, useState, isValidElement, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type Tab = "members" | "borrowers" | "admin"

type FaqItem = { q: string; a: React.ReactNode }
type FaqSection = { title: string; items: FaqItem[] }

// Flattens an answer's JSX into plain text so search can match words that
// only appear in the answer body, not the question -- e.g. "gain sharing"
// only shows up inside an <InfoRow>-style answer, never in its own q.
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join(" ")
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ""
}

function Faq({ q, a, forceOpen }: FaqItem & { forceOpen?: boolean }) {
  return (
    <details
      className="group border-b border-hairline last:border-b-0"
      {...(forceOpen ? { open: true } : {})}
    >
      <summary className="py-4 flex items-start justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-ink">{q}</span>
        <span className="shrink-0 mt-0.5 text-ink-soft text-lg leading-none transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pb-4 text-sm text-ink-soft leading-relaxed space-y-2">{a}</div>
    </details>
  )
}

function FaqSectionCard({ title, items, forceOpen }: FaqSection & { forceOpen?: boolean }) {
  return (
    <div className="mt-6">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">{title}</p>
      <div className="card px-4">
        {items.map((item) => (
          <Faq key={item.q} q={item.q} a={item.a} forceOpen={forceOpen} />
        ))}
      </div>
    </div>
  )
}

const memberSections: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I sign up?",
        a: (
          <p>
            Tap <strong>Sign Up</strong>, choose <strong>Member</strong>, and fill in your name, email, and
            password. Your account starts as <strong>Pending</strong>{" "}
            — an admin needs to approve it before
            you can sign in properly, so you&apos;ll land on a waiting screen until then.
          </p>
        )
      },
      {
        q: "I forgot my password. What do I do?",
        a: <p>On the login screen, tap <strong>Forgot password?</strong> and follow the email link.</p>
      },
      {
        q: "What can I see and do as a member?",
        a: (
          <p>
            Everything about the shared fund: your balance, the fund&apos;s totals, every member&apos;s loans,
            all transactions, investments, and bank balances. You can submit your own contributions,
            withdrawal requests, and loan payments — an admin approves those before they count.
          </p>
        )
      }
    ]
  },
  {
    title: "Your dashboard",
    items: [
      {
        q: "What does \"Available Balance\" mean?",
        a: (
          <p>
            The amount of your own money in the fund you could withdraw right now. If some of your money is
            currently tied up in a loan to another member or in an investment, that&apos;s shown separately
            and isn&apos;t counted as available until it&apos;s repaid or returned.
          </p>
        )
      },
      {
        q: "What's the difference between the \"You\" and \"Fund\" tabs?",
        a: (
          <p>
            <strong>You</strong> shows your own contributions, withdrawals, and gains (bank interest,
            investment performance, and your share of loan interest). <strong>Fund</strong>{" "}
            shows the whole group&apos;s totals — total cash, the split between banks, and open loans.
          </p>
        )
      },
      {
        q: "What's \"Your Breakdown\"?",
        a: (
          <p>
            A personal ledger of your capital and performance — an all-time total plus a year-by-year table
            of your contributions, withdrawals, bank interest, and loan and investment gain share. Open it
            from the <strong>Capital/Performance</strong> card on the You tab, or{" "}
            <strong>My Breakdown</strong>{" "}
            in the menu (☰). Tapping a member&apos;s card on Fund Breakdown opens the same page for them. If
            you&apos;re the borrower on a loan, it also shows right there on your Breakdown, below the
            year-by-year table.
          </p>
        )
      },
      {
        q: "What's that banner saying \"N entries pending approval\"?",
        a: (
          <p>
            It means you&apos;ve submitted something — a contribution, withdrawal, or loan payment — that an
            admin hasn&apos;t approved yet. Tap it to see exactly what&apos;s waiting in{" "}
            <strong>Transactions</strong>.
          </p>
        )
      },
      {
        q: "What's the bell icon for?",
        a: (
          <p>
            It opens <strong>Notifications</strong> — everything Est. 2017 has sent you, like a submission being
            approved or rejected, or a gain/loss landing in your account. Tap one to jump straight to what
            it&apos;s about. From there you can also turn on <strong>Push Notifications</strong>, so you get
            notified on your device even when Est. 2017 isn&apos;t open.
          </p>
        )
      }
    ]
  },
  {
    title: "How the numbers work",
    items: [
      {
        q: "How is my Available Balance calculated?",
        a: (
          <p>
            Everything you&apos;ve put in and earned — contributions, bank interest, investment performance,
            and your share of loan gains — minus withdrawals. If some of that money is currently funding
            another member&apos;s active loan or is tied up in an open investment, that portion isn&apos;t
            available until the loan is repaid or the investment is returned; you&apos;ll see it called out
            separately under your balance.
          </p>
        )
      },
      {
        q: "How does bank interest get split among members?",
        a: (
          <p>
            Proportionally, based on each member&apos;s value in the fund at the time it&apos;s
            distributed — contribution plus anything they&apos;ve already earned (bank interest, loan
            gains, investment gains/losses) — the more you had in, the bigger your share. Anyone with
            nothing in the fund at that point doesn&apos;t get a share.
          </p>
        )
      },
      {
        q: "How is a loan's interest split when it closes?",
        a: (
          <p>
            The same idea: proportional to how much each member had in the fund at that point. The member
            who borrowed the money shares in it too, as long as they had something in the fund at that
            point — anyone with nothing in the fund at that point doesn&apos;t get a share.
          </p>
        )
      },
      {
        q: "How is an investment's gain or loss split among members?",
        a: (
          <p>
            The same principle as a loan: proportional to how much each member had in the fund at the time
            the gain or loss is distributed. An investment can realize gains or losses more than once over
            its life, so this can happen multiple times rather than just once at the end.
          </p>
        )
      },
      {
        q: "What does my \"% of fund\" on Fund Breakdown mean?",
        a: (
          <p>
            Your total value in the fund (contributions plus everything you&apos;ve earned) divided by
            everyone&apos;s total value combined.
          </p>
        )
      },
      {
        q: "How is loan interest calculated?",
        a: (
          <p>
            Either a flat percentage of the amount borrowed, or a fixed peso amount — whichever was agreed
            when the loan was requested. Either way it&apos;s a one-time amount added to the principal, not
            interest that compounds over time.
          </p>
        )
      }
    ]
  },
  {
    title: "Submitting a contribution, withdrawal, or loan payment",
    items: [
      {
        q: "How do I submit a contribution or withdrawal?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>Tap the gold <strong>+</strong> button floating above the bottom navigation.</li>
            <li>Choose <strong>Contribution</strong> or <strong>Withdrawal</strong>.</li>
            <li>
              For a Contribution, enter the amount and bank, and attach a receipt. For a{" "}
              <strong>Withdrawal</strong>, just enter the amount — nothing&apos;s moved yet,
              so the bank and receipt come later, when an admin approves it.
            </li>
            <li>Submit — it shows as <strong>Pending</strong> until an admin approves it.</li>
          </ol>
        )
      },
      {
        q: "How do I make a payment toward my loan?",
        a: (
          <p>
            Same place: <strong>+ New → Loan Payment</strong>. Pick which loan it&apos;s for, enter the
            amount and bank, and attach a receipt.
          </p>
        )
      },
      {
        q: "Can I save a default amount so I don't have to type it every time?",
        a: (
          <p>
            Yes — if you contribute or repay the same amount each time, check{" "}
            <strong>Save as my default amount</strong> the first time you enter it. After that,
            Contribution and Loan Payment both open with that amount already filled in. Change or clear
            it anytime from the menu (☰) → <strong>Preferences</strong>.
          </p>
        )
      },
      {
        q: "How do I request a new loan?",
        a: (
          <p>
            <strong>+ New → Loan Request</strong>. Enter how much you need, the interest (rate or a fixed
            amount), and the term. It goes to an admin to review and activate — you&apos;ll see it as{" "}
            <strong>requested</strong> on the Loans page until then.
          </p>
        )
      },
      {
        q: "Why does everything need a receipt?",
        a: (
          <p>
            So admins have proof of the transfer before approving it. A photo of the bank confirmation or
            deposit slip is enough. If the transfer took more than one screenshot, attach them all —
            you can add as many photos as you need.
          </p>
        )
      },
      {
        q: "I made a mistake — can I fix something I already submitted?",
        a: (
          <p>
            Yes, as long as it&apos;s still <strong>Pending</strong>. On the Transactions page, your own
            pending and rejected entries are listed at the top — tap one, then <strong>Edit</strong> (or{" "}
            <strong>Fix &amp; resend</strong> for a rejected one) to change the amount, bank, receipt, or
            description. Once an admin approves an entry, it can&apos;t be edited anymore.
          </p>
        )
      },
      {
        q: "Can I take back something I submitted?",
        a: (
          <p>
            Yes — tap it on the Transactions page, then <strong>Edit</strong>, and tap{" "}
            <strong>Cancel this entry</strong>{" "}
            near the bottom. It&apos;s removed from your list right away. This can&apos;t be undone from
            the app, so make sure before you tap it.
          </p>
        )
      }
    ]
  },
  {
    title: "Pending, Approved, Rejected",
    items: [
      {
        q: "What do these statuses mean?",
        a: (
          <p>
            <strong>Pending</strong>{" "}
            — waiting on an admin to review it; it doesn&apos;t count toward your balance yet.{" "}
            <strong>Approved</strong> — reviewed and counted. <strong>Rejected</strong>{" "}
            — an admin declined it, usually because something didn&apos;t match (wrong amount, no
            receipt, etc.). You can search and filter your own entries by status on the Transactions page.
          </p>
        )
      }
    ]
  },
  {
    title: "The rest of the app",
    items: [
      {
        q: "What's Fund Breakdown for?",
        a: (
          <p>
            It shows how ownership of the fund is split across everyone — based on net contribution,
            investment performance, bank interest, and loan gain share.
          </p>
        )
      },
      {
        q: "What's Investments for?",
        a: (
          <p>
            It shows each investment the fund holds and how it&apos;s performed, plus each member&apos;s
            share of the gain or loss. Open one to see its recent transactions, or tap{" "}
            <strong>View all</strong> to jump into Transactions pre-filtered to just that investment. Loans
            have the same recent-transactions view and filter on their own detail page.
          </p>
        )
      },
      {
        q: "What does the \"?\" next to the search box on Transactions do?",
        a: (
          <p>
            Tapping it opens a short reminder of what the search box actually matches — member names, banks,
            descriptions, loan and investment names, and transaction types.
          </p>
        )
      },
      {
        q: "What's Banks for?",
        a: (
          <p>
            Each bank account the fund uses, its balance, and the interest it&apos;s earned — including
            interest that&apos;s been approved but not yet split across members.
          </p>
        )
      },
      {
        q: "Where do I change my email or password?",
        a: <p>Open the menu (☰, top left) → <strong>Account</strong>.</p>
      },
      {
        q: "How do I switch between light and dark mode?",
        a: (
          <p>
            Open the menu (☰, top left) → <strong>Appearance</strong>, at the bottom of the menu. Pick{" "}
            <strong>System</strong> to match your device&apos;s setting automatically, or lock it to{" "}
            <strong>Light</strong>/<strong>Dark</strong>.
          </p>
        )
      },
      {
        q: "How do I add Est. 2017 to my phone's home screen?",
        a: (
          <p>
            Open <Link href="/install" className="text-gold hover:underline">the install guide</Link> on your phone
            — it walks through both iPhone (Safari) and Android (Chrome) with step-by-step screens.
          </p>
        )
      }
    ]
  }
]

const borrowerSections: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I sign up as a borrower?",
        a: (
          <p>
            Tap <strong>Sign Up</strong> and choose <strong>Borrow money</strong> instead of Join the fund. Your account
            starts as <strong>Pending</strong> until an admin approves it.
          </p>
        )
      },
      {
        q: "What can a borrower account see?",
        a: (
          <p>
            Only your own loan — its balance, repayment history, and terms. A borrower account can&apos;t see
            the fund&apos;s dashboard, other members, or anyone else&apos;s data.
          </p>
        )
      },
      {
        q: "What's the bell icon for?",
        a: (
          <p>
            It opens <strong>Notifications</strong> — things like your loan payment being approved or
            rejected. Tap one to jump straight to what it&apos;s about. From there you can also turn on{" "}
            <strong>Push Notifications</strong>, so you get notified on your device even when Est. 2017 isn&apos;t
            open.
          </p>
        )
      }
    ]
  },
  {
    title: "Requesting a loan",
    items: [
      {
        q: "How do I request a loan?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>From your loan page, tap <strong>Request a Loan</strong>.</li>
            <li>Enter how much you need.</li>
            <li>Choose interest as a <strong>rate</strong> (%) or a <strong>fixed amount</strong>.</li>
            <li>Enter the term (in months) and how often you&apos;ll repay.</li>
            <li>Submit — it goes to an admin to approve and activate.</li>
          </ol>
        )
      },
      {
        q: "How will I know if my loan was approved?",
        a: <p>Once an admin approves it, its status changes from <strong>requested</strong> to <strong>active</strong> on your loan page, and it&apos;ll show the bank the money was sent from.</p>
      },
      {
        q: "How is my total repayment amount calculated?",
        a: (
          <p>
            Principal plus interest. Interest is either a percentage of what you borrowed, or a flat peso
            amount — whichever you chose when requesting the loan. It&apos;s a one-time amount added to the
            principal, not interest that grows over time, so your total doesn&apos;t change while you&apos;re
            repaying it.
          </p>
        )
      }
    ]
  },
  {
    title: "Repaying a loan",
    items: [
      {
        q: "How do I make a payment?",
        a: (
          <ol className="list-decimal list-inside space-y-1">
            <li>From your loan page, tap <strong>Make a payment</strong>.</li>
            <li>Send the money to one of the fund&apos;s banks — <strong>Scan to Pay</strong> on your loan page shows where.</li>
            <li>Enter the amount and which bank you sent it to. It starts at your usual payment; tick{" "}
              <strong>Remember for next time</strong> to keep the amount and bank for your next one.</li>
            <li>Attach a receipt or screenshot of the transfer.</li>
            <li>Submit — it shows as <strong>pending</strong> until an admin approves it.</li>
          </ol>
        )
      },
      {
        q: "Will I get reminded when a payment is due?",
        a: (
          <p>
            Yes. You get a notification 3 days before each payment is due, on the due date itself, and the
            day after if it hasn&apos;t been paid yet, then every 10 days until it is. Monthly loans are due
            on the loan&apos;s due day each month; a lump-sum loan is due once, on the date picked for it or else at the end of its term. An
            older monthly loan with no due day set instead gets an overdue reminder once 45 days pass
            without a payment, then every 10 days after that. Reminders pause while a payment
            you submitted is waiting for approval. Turn on <strong>Push Notifications</strong> to get them on
            your device.
          </p>
        )
      },
      {
        q: "Why isn't my payment reflected yet?",
        a: (
          <p>
            It needs an admin to approve it first — that&apos;s what keeps the numbers accurate. Once
            approved, your loan balance updates.
          </p>
        )
      },
      {
        q: "I entered the wrong amount — can I fix a payment I already submitted?",
        a: (
          <p>
            Yes, as long as it&apos;s still <strong>pending</strong>. Tap the payment on your loan page, then{" "}
            <strong>Edit</strong> to change the amount, bank, receipt, or description, or to cancel it
            entirely. If an admin rejected it, the same screen shows why — tap <strong>Fix &amp; resend</strong>.
            Once an admin approves it, it can no longer be changed.
          </p>
        )
      },
      {
        q: "Can I fix or cancel a loan request I already submitted?",
        a: (
          <p>
            Not from your account — unlike a repayment, a loan request needs an admin to make any change to
            it. Message your admin directly and they can correct or reject it before it&apos;s activated.
          </p>
        )
      }
    ]
  }
]

const adminSections: FaqSection[] = [
  {
    title: "The Admin panel",
    items: [
      {
        q: "Where do I approve things?",
        a: (
          <p>
            Open the menu (☰) → <strong>Admin</strong>. The <strong>Approvals</strong> tab is organized
            into four sub-tabs — <strong>Members</strong>, <strong>Txns</strong>,{" "}
            <strong>Borrowers</strong>, and <strong>Distrib.</strong> — each one only showing what
            actually needs a decision. Tap a row to open it and see the Approve/Reject buttons.{" "}
            <strong>Support</strong>, next to Approvals, is a separate tool for fixing a mistake on
            something already recorded, not for approving anything new.
          </p>
        )
      },
      {
        q: "How do I approve a new member or borrower signup?",
        a: (
          <p>
            New signups show up in the Admin queue under <strong>New signups</strong> (members) or{" "}
            <strong>Borrower requests</strong>. Tap one, then <strong>Approve</strong>. If a new member
            signup is someone the fund already has a record for (added before they had an account), pick
            them under <strong>Already a member?</strong> and tap <strong>Link &amp; approve</strong> so
            their history carries over.
          </p>
        )
      },
      {
        q: "How do I approve a transaction?",
        a: (
          <p>
            <strong>Txns</strong> tab, tap a row, then <strong>Approve</strong> or <strong>Reject</strong>.
            Withdrawals and loan releases each also need you to pick which bank the money is coming from
            before you can approve — that field shows up right there in the row.
          </p>
        )
      },
      {
        q: "How do I know an approval landed in the right bank?",
        a: (
          <p>
            Before you approve, each review (and the bulk Approve bar) shows which bank balance it moves and what
            it&apos;ll be afterwards — or that it won&apos;t move any bank, if it has no bank set or doesn&apos;t
            affect cash. Afterwards, a confirmation at the top of the queue shows each bank&apos;s new balance; tap{" "}
            <strong>View →</strong> to open that bank, where <strong>Recent Activity</strong> lists the latest
            entries with the ones you just approved marked, and <strong>View all →</strong> opens Transactions
            filtered to that bank. Entries you record yourself (Bank Interest, Expense, Bank Transfer, Investment)
            show the same before → after line above Submit, and the saved message shows each bank&apos;s new
            balance.
          </p>
        )
      },
      {
        q: "What happens when I approve a loan release?",
        a: (
          <p>
            It does two things at once: activates the loan (its status changes from{" "}
            <strong>requested</strong> to <strong>active</strong>) and records which bank disbursed it — you
            don&apos;t need a separate step on the loan&apos;s own page. The loan starts on the day you approve
            it, so its due dates and reminders count from then. If a big loan takes a few days to send because of
            the bank&apos;s daily transfer limit, approve it once the last transfer has gone out and attach every
            transfer&apos;s screenshot.
          </p>
        )
      },
      {
        q: "How do I distribute bank interest or edit a bank?",
        a: (
          <p>
            Go to <strong>Breakdown</strong> → <strong>Banks</strong>. From January, last year&apos;s interest
            waiting to be split is listed at the top — once December&apos;s interest and tax are logged for both
            banks, open one and tap <strong>Review &amp; distribute</strong> to see each member&apos;s share
            before confirming. It&apos;s recorded as of Dec 31 of that year. To rename a bank or change its scan-to-pay QR, open the bank
            and tap <strong>⋯</strong> next to its name. <strong>+ Add Bank</strong> is on the Banks list.
          </p>
        )
      },
      {
        q: "How do I back up the full transaction ledger?",
        a: (
          <p>
            Tap <strong>Export</strong> near the top of the Admin panel. It downloads every transaction,
            of every status, as a spreadsheet with member, bank, loan, investment, and submitter names
            already resolved.
          </p>
        )
      },
      {
        q: "What's the Support tab for?",
        a: (
          <p>
            Finding and fixing a mistake on a transaction that&apos;s already on record — wrong amount,
            bank, date, receipt, or status — no matter who it belongs to or whether it&apos;s already
            approved. Search for it, tap <strong>Fix →</strong>, and correct it. It doesn&apos;t run
            approval side effects like activating a loan, so it&apos;s for corrections, not routine
            approvals — those still go through <strong>Approvals</strong>. Entries generated
            automatically from a loan, investment, or bank interest distribution (&quot;Investment
            Allocation&quot;) can&apos;t be edited here — fix the distribution itself instead.
          </p>
        )
      }
    ]
  },
  {
    title: "Managing members and borrowers",
    items: [
      {
        q: "How do I add a member manually, edit one, or deactivate one?",
        a: (
          <p>
            Admin → the people icon (next to Chat and Export) takes you to <strong>Members</strong>, the
            full roster of members and borrowers. Tap <strong>+ Add</strong> to add someone, or tap a person to
            edit their name/email/role, message them, see their loans, or deactivate/reactivate them.
            The edit form has a <strong>Shares in gains</strong> checkbox — uncheck it to exclude someone
            from future bank interest, loan, and investment distributions without deactivating them
            entirely. Deactivating turns this off automatically, and reactivating restores it unless
            they&apos;re a borrower (borrowers never share in gains).
          </p>
        )
      },
      {
        q: "How do I see every borrower account, not just pending ones?",
        a: (
          <p>
            On <strong>Members</strong> (Admin → the people icon), tap the <strong>Borrowers</strong>{" "}
            filter. Tap one to see their loans, message them, or view the app as them.
          </p>
        )
      }
    ]
  },
  {
    title: "Recording things on someone's behalf",
    items: [
      {
        q: "How do I record a transaction for a member myself?",
        a: (
          <p>
            <strong>+ New</strong>, same as members use, but as an admin you can pick{" "}
            <strong>on behalf of</strong> a specific member. For a Contribution or Loan Payment,
            that entry posts as approved immediately instead of going into the pending queue — the
            bank and receipt are already collected right there on the form. A Withdrawal or Loan
            Request still goes into the pending queue either way, since nothing&apos;s moved yet
            and that evidence still needs to be collected when it&apos;s approved.
          </p>
        )
      },
      {
        q: "Can I set a default contribution or repayment amount for a member?",
        a: (
          <p>
            Yes — the first time you record a Contribution or Loan Payment{" "}
            <strong>on behalf of</strong> a member, the same <strong>Save as default amount</strong>{" "}
            checkbox members see saves it to their account instead of yours, so it&apos;s pre-filled the
            next time either of you enters one.
          </p>
        )
      },
      {
        q: "What are the admin-only entry types for?",
        a: (
          <p>
            <strong>Expense</strong>, <strong>Bank Interest</strong>, <strong>Bank Transfer</strong>,{" "}
            <strong>Investment</strong>, and <strong>Investment Return</strong>{" "}
            — fund-level entries that aren&apos;t tied to a single member&apos;s contribution. These post
            as approved right away.{" "}
            <strong>Investment</strong> and <strong>Investment Return</strong> only record cash moving in or
            out; once a gain or loss is actually realized, split it to members with{" "}
            <strong>Distribute Gain/Loss</strong>{" "}
            on that investment&apos;s own page.
          </p>
        )
      },
      {
        q: "Can I edit something after I've recorded it?",
        a: (
          <p>
            Tap an Expense, Bank Interest, or Bank Transfer entry on Transactions and it has an{" "}
            <strong>Edit</strong> button any time — but only for whichever admin actually recorded them, not
            any admin, since they&apos;re never in a member&apos;s pending queue to begin with. Need to
            fix one someone else recorded (or an older entry from before this was tracked)? Use{" "}
            <strong>Support</strong>{" "}
            instead. A pending Loan Release can also be edited or cancelled
            (cancelling deletes the loan request entirely) right up until you activate it — once a loan is
            active, changes move to that loan&apos;s own page instead (tap <strong>⋯</strong> next to its
            name → <strong>Edit terms</strong>).
          </p>
        )
      }
    ]
  },
  {
    title: "Loans, investments, and banks",
    items: [
      {
        q: "How do I close a loan, edit its terms, or reopen one?",
        a: (
          <p>
            Open the loan itself (Loans → tap it). When it&apos;s waiting on you — a release, or a full
            repayment ready to close — a <strong>Next Step</strong> card shows the one thing to do, and closing
            shows each member&apos;s share before you confirm. Everything else is behind <strong>⋯</strong> next
            to the loan&apos;s name: Edit terms, Close early (settle before it&apos;s fully repaid, gain or loss
            either way), and, for closed loans, Reopen. Loans needing attention, including overdue ones, are
            listed at the top of the Loans tab.
          </p>
        )
      },
      {
        q: "How does \"Close & Distribute\" split the gain (or loss)?",
        a: (
          <p>
            Proportionally across members, based on how much each has in the fund at that moment — same
            principle as a bank interest distribution. The borrower shares in their own loan&apos;s result
            too, as long as they had something in the fund at that moment — anyone with nothing in the fund
            at that point doesn&apos;t get a share.
          </p>
        )
      },
      {
        q: "How do I record an investment's gain or loss?",
        a: (
          <p>
            Open the investment. When it has realized gain that hasn&apos;t been split yet, a{" "}
            <strong>Ready to Distribute</strong> card shows it — tap <strong>Review &amp; distribute</strong>. You
            can also use <strong>⋯</strong> next to its name → <strong>Distribute gain/loss</strong> any time. The
            amount starts at what&apos;s undistributed as of the chosen date; switch Gain/Loss, change the date or
            amount, and you&apos;ll see each member&apos;s share before confirming. It splits by each member&apos;s
            value in the fund on that date, the same way a loan close does, and you can do this more than once
            as an investment realizes gains or losses over time. <strong>Close investment</strong> in the same
            menu settles whatever&apos;s left and marks it closed.
          </p>
        )
      },
      {
        q: "How do I add or edit an investment or bank account?",
        a: (
          <p>
            Tap <strong>+ Add Investment</strong> or <strong>+ Add Bank</strong> at the top of the Investments or
            Banks tab. To edit one, open it and tap <strong>⋯</strong> next to its name — admins see that menu,
            members don&apos;t.
          </p>
        )
      }
    ]
  }
]

export default function HelpPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()

  const [activeTab, setActiveTab] = useState<Tab>("members")
  const [tabInitialized, setTabInitialized] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }
  }, [authLoading, member, router])

  // Default to whichever tab matches the viewer's own role, once, the
  // first time it's known -- after that leave it alone so switching tabs
  // sticks.
  useEffect(() => {
    if (tabInitialized || !member) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- defaults the tab to the viewer's role once, the first time it's known
    setActiveTab(member.role === "borrower" ? "borrowers" : member.role === "admin" ? "admin" : "members")
    setTabInitialized(true)
  }, [member, tabInitialized])

  const checkingAccess = authLoading || !member || member.status !== "approved"
  const isBorrower = member?.role === "borrower"

  // Borrower accounts can't do anything the Members/Admin sections
  // describe -- they can't see the fund dashboard, other members, or the
  // Admin panel at all -- so only the Borrowers tab is relevant, and there's
  // nothing else worth switching to.
  const tabs: { id: Tab; label: string; sections: FaqSection[] }[] = isBorrower
    ? [{ id: "borrowers", label: "Borrowers", sections: borrowerSections }]
    : [
        { id: "members", label: "Members", sections: memberSections },
        { id: "borrowers", label: "Borrowers", sections: borrowerSections },
        { id: "admin", label: "Admin", sections: adminSections }
      ]

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  // Computed unconditionally (before the checkingAccess early return below)
  // so this hook call is never skipped on some renders -- tabs/active above
  // are safe to compute this early since they only depend on isBorrower and
  // activeTab, both already known regardless of auth-loading state.
  const trimmedQuery = query.trim().toLowerCase()
  const filteredSections = useMemo(() => {
    if (!trimmedQuery) return active.sections
    return active.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          `${item.q} ${nodeText(item.a)}`.toLowerCase().includes(trimmedQuery)
        )
      }))
      .filter((section) => section.items.length > 0)
  }, [active, trimmedQuery])

  if (checkingAccess) {
    return (
      <>
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {isBorrower ? <BorrowerHeader /> : <Navbar />}
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push(isBorrower ? "/borrower" : "/menu")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {isBorrower ? "← Your Loan" : "← Menu"}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Reference
          </div>
          <h1 className="font-display text-4xl font-semibold">Help</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-md">
            Est. 2017 is meant to be simple enough to use without a manual. This is here for whenever you want a
            quick refresher, organized by what you&apos;re trying to do.
          </p>

          {tabs.length > 1 && (
            <div className="mt-6 flex card p-[3px]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id)
                    setQuery("")
                    window.scrollTo(0, 0)
                  }}
                  className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                    activeTab === t.id ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative mt-5">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-soft pointer-events-none"
            >
              <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M17 17l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${active.label.toLowerCase()} help`}
              className="w-full card pl-10 pr-9 py-2.5 text-sm text-ink placeholder:text-ink-soft outline-none focus:border-gold transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {trimmedQuery && filteredSections.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12">
              No results for &quot;{query.trim()}&quot; in {active.label}.
            </p>
          )}

          {filteredSections.map((section) => (
            <FaqSectionCard
              key={section.title}
              title={section.title}
              items={section.items}
              forceOpen={!!trimmedQuery}
            />
          ))}
        </div>
      </main>
    </>
  )
}
