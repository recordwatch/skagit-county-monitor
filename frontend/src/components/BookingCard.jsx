import { useState } from 'react'
import { formatDate, formatDateTime, formatMoney, timeHeld, agencyName, courtName, releaseTime } from '../format'

export default function BookingCard({ entry }) {
  const [open, setOpen] = useState(false)

  const isReleased = entry.status === 'released'
  const held = isReleased ? timeHeld(entry.bookedAt, entry.releasedAt) : null

  return (
    <div className={`card ${isReleased ? 'card-released' : 'card-custody'}`}>
      <div className="card-header" onClick={() => setOpen(!open)}>
        <div className="card-left">
          <div className="card-name">{entry.name}</div>
          <div className="card-meta">
            #{entry.nameNumber} &nbsp;·&nbsp; Booked: {formatDateTime(entry.bookedAt) || 'N/A'}
            {held && <span className="card-time-held"> &nbsp;·&nbsp; Held: {held}</span>}
          </div>
        </div>
        <div className="card-right">
          <span className={`badge ${isReleased ? 'badge-released' : 'badge-custody'}`}>
            {isReleased ? 'Released' : 'In Custody'}
          </span>
          <span className="card-toggle">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="card-body">
          {isReleased && entry.releasedAt && (
            <div className="card-release-row">
              Released: {releaseTime(entry, formatDateTime)}
              {held && <span className="card-time-held-detail"> &nbsp;·&nbsp; Time held: {held}</span>}
            </div>
          )}
          {entry.fromReleaseReport && (
            <div className="card-release-row">
              Booked and released between our checks — taken from the county's release report.
            </div>
          )}
          {!isReleased && entry.scheduledRelease && (
            <div className="card-release-row">Scheduled release: {formatDate(entry.scheduledRelease)}</div>
          )}

          <div className="card-description">
            <div className="desc-row">
              <span>Location</span><span>{entry.location || 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Arresting Agency</span><span>{agencyName(entry.arrestingAgency)}</span>
            </div>
            <div className="desc-row">
              <span>Arrest Type</span><span>{entry.arrestType || 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Bail Total</span><span>{formatMoney(entry.bondTotal) || 'None'}</span>
            </div>
          </div>

          {entry.charges?.length > 0 && (
            <div className="card-charges">
              <div className="charges-title">Charges ({entry.charges.length})</div>
              {entry.charges.map((c, i) => (
                <div key={i} className="charge-row">
                  <div className="charge-violation">
                    {c.description}
                    {c.disposition && <span className="charge-add-desc"> — {c.disposition}</span>}
                  </div>
                  {c.court && (
                    <div className="charge-court">
                      {courtName(c.court)}{c.courtReference && ` · ${c.courtReference}`}
                    </div>
                  )}
                  {(c.bailType || c.bailAmount) && (
                    <div className="charge-bail">
                      Bail: {[c.bailType, formatMoney(c.bailAmount)].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {c.agency && <div className="charge-agency">Arrested by: {agencyName(c.agency)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
