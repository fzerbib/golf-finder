#!/usr/bin/env ruby
# One-off script: pulls all OSM "golf=hole" ways in France and Spain (par, handicap
# index, per-tee distances when tagged). Coverage is patchy — some courses have every
# hole fully tagged, most have none — that's expected and handled at merge time.
# Output: data/osm_holes.json (raw, deduped).
require "net/http"
require "uri"
require "json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

FRANCE_REGIONS = {
  "FR-ARA" => "Auvergne-Rhône-Alpes",
  "FR-BFC" => "Bourgogne-Franche-Comté",
  "FR-BRE" => "Bretagne",
  "FR-CVL" => "Centre-Val de Loire",
  "FR-COR" => "Corse",
  "FR-GES" => "Grand Est",
  "FR-HDF" => "Hauts-de-France",
  "FR-IDF" => "Île-de-France",
  "FR-NOR" => "Normandie",
  "FR-NAQ" => "Nouvelle-Aquitaine",
  "FR-OCC" => "Occitanie",
  "FR-PDL" => "Pays de la Loire",
  "FR-PAC" => "Provence-Alpes-Côte d'Azur"
}.freeze

SPAIN_REGIONS = {
  "ES-AN" => "Andalousie",
  "ES-AR" => "Aragon",
  "ES-AS" => "Asturies",
  "ES-CN" => "Canaries",
  "ES-CB" => "Cantabrie",
  "ES-CM" => "Castille-La Manche",
  "ES-CL" => "Castille-et-León",
  "ES-CT" => "Catalogne",
  "ES-EX" => "Estrémadure",
  "ES-GA" => "Galice",
  "ES-IB" => "Îles Baléares",
  "ES-RI" => "La Rioja",
  "ES-MD" => "Communauté de Madrid",
  "ES-MC" => "Murcie",
  "ES-NC" => "Navarre",
  "ES-PV" => "Pays basque",
  "ES-VC" => "Communauté valencienne"
}.freeze

def fetch_region(iso_code, attempt = 1)
  query = <<~QL
    [out:json][timeout:90];
    area["ISO3166-2"="#{iso_code}"]["admin_level"="4"]->.a;
    way["golf"="hole"](area.a);
    out center tags;
  QL

  uri = URI(OVERPASS_URL)
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 20
  http.read_timeout = 100
  request = Net::HTTP::Post.new(uri.request_uri)
  request["User-Agent"] = "golf-finder-research/1.0 (contact: local test script)"
  request["Accept"] = "*/*"
  request.set_form_data("data" => query)
  res = http.request(request)

  if ["429", "504", "502", "503"].include?(res.code) && attempt <= 5
    wait = 20 * attempt
    warn "  ! HTTP #{res.code} for #{iso_code}, retrying in #{wait}s (attempt #{attempt})"
    sleep wait
    return fetch_region(iso_code, attempt + 1)
  end

  unless res.is_a?(Net::HTTPSuccess)
    warn "  ! HTTP #{res.code} for #{iso_code}, giving up"
    return []
  end

  body = JSON.parse(res.body)
  elements = body["elements"] || []
  elements.select { |e| e.dig("tags", "ref") }
rescue => e
  if attempt <= 4
    warn "  ! Error for #{iso_code}: #{e.message}, retrying in 15s (attempt #{attempt})"
    sleep 15
    return fetch_region(iso_code, attempt + 1)
  end
  warn "  ! Error for #{iso_code}: #{e.message}, giving up"
  []
end

def to_record(el, country, region)
  tags = el["tags"] || {}
  distances = {}
  tags.each { |k, v| distances[k.sub("dist:", "")] = v.to_i if k.start_with?("dist:") }
  {
    "osmId" => el["id"],
    "country" => country,
    "region" => region,
    "name" => tags["name"],
    "ref" => tags["ref"],
    "par" => tags["par"]&.to_i,
    "handicap" => tags["handicap"]&.to_i,
    "distances" => distances,
    "lat" => el["lat"] || el.dig("center", "lat"),
    "lon" => el["lon"] || el.dig("center", "lon")
  }
end

all = []

def write_output(all)
  seen = {}
  deduped = []
  all.each do |rec|
    key = rec["osmId"]
    next if seen[key]
    seen[key] = true
    deduped << rec
  end
  File.write("data/osm_holes.json", JSON.pretty_generate(deduped))
  deduped.length
end

begin
  [[FRANCE_REGIONS, "France"], [SPAIN_REGIONS, "Espagne"]].each do |regions, country|
    regions.each do |iso, label|
      print "Fetching #{country} / #{label} (#{iso})... "
      $stdout.flush
      els = fetch_region(iso)
      els.each { |el| all << to_record(el, country, label) }
      puts "#{els.length} hole(s)"
      write_output(all)
      sleep 3
    end
  end
ensure
  n = write_output(all)
  puts "\nTotal fetched: #{all.length}, after dedupe: #{n}"
  puts "Written to data/osm_holes.json"
end
