INSERT INTO show_seats (show_id, venue_seat_id, price_paise)
SELECT s.id, vs.id, scp.price_paise
  FROM shows s
  JOIN venue_seats vs ON vs.venue_id = s.venue_id
  JOIN show_category_prices scp ON scp.show_id = s.id AND scp.category = vs.category
ON CONFLICT (show_id, venue_seat_id) DO NOTHING;
