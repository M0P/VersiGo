'use client';

import { useEffect, useState, type ReactElement } from 'react';

import type { CostEntryPrefill } from '@/lib/cost-suggestion';
import BillingDocumentsSidebar from './billing-documents-sidebar';
import CostsOverviewCard from './costs-overview-card';

type Props = {
  policyId: string;
  /** Switches to the documents tab (classification of the billing documents). */
  onOpenClassification: () => void;
};

/**
 * AP-24 (§4.1): the costs tab = billing-documents sidebar + cost management.
 *
 * The sidebar is rendered inline (no route change) so the previous behaviour
 * of the tab is preserved. Responsive behaviour is CSS-driven plus one small
 * media query here: on desktop (>= 1024px) the sidebar is always visible, on
 * tablet it is collapsible and on smartphones the expanded sidebar becomes a
 * bottom sheet (see `globals.css`).
 *
 * The AI proposal never reaches this component: the sidebar prefills the
 * create form of the cost card and the user confirms the save there.
 */
export default function CostsTab({ policyId, onOpenClassification }: Props): ReactElement {
  // Token that changes with every AI proposal, so the cost card can apply it
  // exactly once (a second proposal for the same document stays possible).
  const [prefill, setPrefill] = useState<CostEntryPrefill | null>(null);
  // Changes after cost writes, so the sidebar refreshes its "used" marking
  // without a page reload.
  const [refreshToken, setRefreshToken] = useState(0);
  // Tablet/smartphone: the sidebar starts collapsed. Desktop is forced open by
  // CSS, so this state is only relevant below 1024px.
  const [collapsed, setCollapsed] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <div className="costs-layout">
      <BillingDocumentsSidebar
        policyId={policyId}
        refreshToken={refreshToken}
        onOpenClassification={onOpenClassification}
        onPrefill={setPrefill}
        // On desktop the sidebar is always expanded, so its toggle stays
        // accurate for assistive technology as well.
        collapsed={isDesktop ? false : collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />
      <div className="costs-main">
        <CostsOverviewCard
          policyId={policyId}
          prefill={prefill}
          onEntriesChanged={() => setRefreshToken((value) => value + 1)}
        />
      </div>
    </div>
  );
}
