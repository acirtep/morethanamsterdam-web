PREPARE download_data AS
COPY (
    WITH calendar_dates AS (
        SELECT generate_series AS calendar_date,
               isodow(calendar_date) AS day_of_week
        FROM generate_series(
            $1::date - INTERVAL '12' days,
            $1::date - INTERVAL '6' days,
            INTERVAL '1' days
        )
    ),
    raw_data AS (
        SELECT "Service:RDT-ID" AS service_id,
               "Stop:Station code" AS station_code,
               "Stop:Arrival time"::timestamp AS arrival_time,
               "Stop:Departure time"::timestamp AS departure_time,
               "Service:Date" AS service_date,
               row_number() OVER (
                   PARTITION BY service_id 
                   ORDER BY departure_time NULLS LAST
               ) AS stop_number,
               day_of_week,
               sm.municipality_sk,
               sm.province_sk
        FROM read_csv('https://opendata.rijdendetreinen.nl/public/services/services-'||strftime($1::date, '%Y-%m')||'.csv.gz')
        INNER JOIN calendar_dates ON "Service:Date" = calendar_dates.calendar_date
        INNER JOIN '../data/train_stations.csv' sm
            ON "Stop:Station code" = sm.station_code
    ),
    exploded_raw_data AS (
        SELECT from_.day_of_week,
               from_.service_id,
               time_bucket(INTERVAL '5 minutes', from_.departure_time) AS departure_time_tb,
               from_.station_code AS from_station_code,
               from_.municipality_sk AS from_municipality_sk,
               from_.province_sk AS from_province_sk,
               to_.station_code AS to_station_code,
               time_bucket(INTERVAL '5 minutes', to_.arrival_time) AS arrival_time_tb,
               to_.municipality_sk AS to_municipality_sk,
                to_.province_sk AS to_province_sk
        FROM raw_data from_
        JOIN raw_data to_ ON (
            from_.service_id = to_.service_id
            AND from_.stop_number < to_.stop_number
        )
    )
    SELECT * FROM exploded_raw_data
    WHERE
        from_municipality_sk != to_municipality_sk
        AND date_diff('minute', departure_time_tb, arrival_time_tb) <= 60
) 
TO '../data/train_services.parquet'
WITH (
    format 'parquet', 
    compression 'zstd', 
    partition_by (day_of_week),
    overwrite
);
