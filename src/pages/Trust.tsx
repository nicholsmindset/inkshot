import { Link } from 'react-router-dom';
import { BrandMark } from '../ui';
import './trust.css';

export function TrustLinks(){return <nav className="trust-links" aria-label="Policies"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms & refunds</Link><Link to="/ai-notice">AI content</Link></nav>;}
const copy={
  privacy:{title:'Your work, your privacy.',sections:[
    ['What Inkshot stores','Your account name and email, brand information, approved website excerpts, uploaded photos and logos, campaign instructions, generated files and credit activity are used to provide your studio. Sign-in cookies keep your session secure.'],
    ['Services that process your work','Hosted accounts and private media use Supabase. The site runs on Vercel. When live generation is enabled, approved content is sent to the configured writing provider (Anthropic or OpenRouter) and Higgsfield. Payment details go to Stripe when checkout is enabled; Inkshot does not store your card number. Preview generation uses sample assets.'],
    ['Your choices','Review and correct imported information before approving a campaign. Only upload photos, logos and other material you have permission to use. Do not upload sensitive personal information or material belonging to someone who has not agreed to its use.'],
    ['Account deletion','When enabled in Settings, account deletion closes your workspace and queues removal of its application records, private files and managed sign-in identity. A failed external deletion is retried and is not marked complete. Active subscriptions and unfinished generation must be resolved first. Shared environments need an ownership review.'],
    ['What can remain','Backups, security records and records required for accounting may remain under the relevant service’s retention policy. Higgsfield retains request identifiers and billing metadata after deleting request inputs and outputs; separately uploaded provider files and third-party processing have their own retention rules. This is not a promise that every third-party copy disappears immediately.'],
    ['Before paid launch','The operator must publish its legal identity, a verified privacy contact, retention periods and international-transfer details. These launch details have not yet been approved.'],
  ]},
  terms:{title:'A clear agreement.',sections:[
    ['Preview service','Inkshot helps you prepare advertising creative from a brief you approve. Preview assets are examples; they do not establish provider quality, campaign performance or legal compliance. These terms are a draft for owner review, not a completed paid-service agreement.'],
    ['Your responsibility','You need permission to use uploaded material and to advertise the products or services in your brief. Check facts, prices, claims, captions, destination URLs and permissions before publishing. Do not submit deceptive offers or present generated testimonials as real customer statements.'],
    ['Credits and failed work','The studio shows the credit cost before approval. An asset that fails to finish returns its reserved credits through the credit ledger. A returned generation credit is not a cash refund.'],
    ['Cancellation','Where subscriptions are enabled, use Usage & billing to open the Stripe billing portal. The portal shows the cancellation options available for your subscription. Deleting a studio does not silently cancel an active payment agreement; resolve the subscription first.'],
    ['Refund policy — pending approval','A cash-refund policy and a verified support route must be published before accepting paid customers. No unconditional cash-refund promise is made in this preview. Any rights required by applicable law remain unaffected.'],
    ['Before paid launch','The operator must approve its legal identity, jurisdiction, customer support route, billing currency, cancellation timing, refunds and the final agreement. Live checkout must remain closed until that review is complete.'],
  ]},
  ai:{title:'Made with AI. Reviewed by you.',sections:[
    ['How creative is made','AI can suggest a brief, advertising angles and visuals. It can misunderstand a business, invent details or produce visual defects. Review the source evidence and edit the brief and prompts before generation.'],
    ['Before you publish','Check product appearance, prices, offers, spellings, logos, captions, landing links and advertising claims. Generated people and scenes are not evidence of a real customer experience. No creative or competitor observation guarantees sales, clicks or return on ad spend.'],
    ['Certification and disclosure','Do not use an AI-generated certification mark or imply certification without valid evidence and permission. Follow the disclosure rules of the advertising platform and the rules that apply to your business.'],
  ]},
};
export function TrustPage({kind}:{kind:keyof typeof copy}){
  const page=copy[kind];
  return <main className="trust-page"><Link to="/" aria-label="Inkshot home"><BrandMark/></Link><p className="eyebrow">INKSHOT / SERVICE INFORMATION</p><h1>{page.title}</h1><aside className="trust-draft" role="note">Preview notice · operator details and paid-service policies are awaiting owner approval.</aside>{page.sections.map(([title,body])=><section key={title}><h2>{title}</h2><p>{body}</p></section>)}<TrustLinks/><Link className="text-link" to="/">Back to Inkshot</Link></main>;
}
