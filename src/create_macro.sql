CREATE OR REPLACE MACRO get_trips(
                  input_day_of_week,
                  input_station_code,
                  input_hour_departure,
                  input_minute_departure,
                  input_to_station_code,
                  input_hour_arrival,
                  input_layover_time,
                  input_to_municipality_sk
) AS TABLE
WITH RECURSIVE train_schedule AS MATERIALIZED (
    SELECT src.*,
            date_diff('minute', departure_time_tb, arrival_time_tb) as travel_time
    FROM read_parquet(
        './data/train_services.parquet/day_of_week='||input_day_of_week::varchar||'/data_0.parquet'
    ) src
    WHERE NOT (to_municipality_sk = input_to_municipality_sk AND to_station_code != input_to_station_code)
    AND travel_time between 15 and 60
),

planning AS (
    SELECT
        from_station_code,
        to_station_code,
        [from_station_code, to_station_code] AS path,
        [departure_time_tb, arrival_time_tb] AS time_schedule,
        [from_municipality_sk, to_municipality_sk] AS municipalities,
        [from_province_sk, to_province_sk] AS provinces,
        travel_time,
        departure_time_tb,
        arrival_time_tb,
        0 AS end_reached,
        to_municipality_sk,
        tss.number_of_monuments
    FROM train_schedule
    JOIN './data/train_stations.csv' tss on to_station_code = station_code
    WHERE
        from_station_code = input_station_code
        AND hour(departure_time_tb) = input_hour_departure
        AND minute(departure_time_tb) = input_minute_departure
        AND to_station_code != input_to_station_code
    UNION ALL
    SELECT
        ts.from_station_code,
        ts.to_station_code,
        array_append(path, ts.to_station_code) AS path,
        array_append(
            array_append(time_schedule, ts.departure_time_tb),
            ts.arrival_time_tb
        ) AS time_schedule,
        array_append(municipalities, ts.to_municipality_sk) AS municipalities,
        array_append(provinces, ts.to_province_sk) AS provinces,
        planning.travel_time + ts.travel_time AS travel_time,
        ts.departure_time_tb,
        ts.arrival_time_tb,
        max((
            ts.to_station_code = input_to_station_code
            AND hour(ts.arrival_time_tb) = input_hour_arrival
        )::int) OVER (
            rows between unbounded preceding and unbounded following
        ) AS end_reached,
        planning.to_municipality_sk,
        planning.number_of_monuments + tss.number_of_monuments as number_of_monuments
    FROM planning
    JOIN train_schedule ts
        ON
            planning.to_station_code = ts.from_station_code
            AND time_bucket(INTERVAL '15 minutes', planning.arrival_time_tb + INTERVAL  (input_layover_time) HOUR) = time_bucket(INTERVAL '15 minutes', ts.departure_time_tb)
    JOIN './data/train_stations.csv' tss on ts.to_station_code = tss.station_code
    WHERE
        (
        ( list_position(municipalities, ts.to_municipality_sk) IS NULL AND ts.to_municipality_sk != input_to_municipality_sk)
        OR (
            ts.to_station_code = input_to_station_code
            AND hour(ts.arrival_time_tb) = input_hour_arrival
        ))
        AND planning.end_reached = 0
),

distinct_paths AS (
    SELECT
        path,
        travel_time,
        time_schedule,
        municipalities,
        list_distinct(provinces) provinces,
        number_of_monuments
    FROM planning
    WHERE
        to_station_code = input_to_station_code
        AND hour(arrival_time_tb) = input_hour_arrival
    QUALIFY row_number() OVER (PARTITION BY list_sort(path) ORDER BY travel_time) = 1
),

optimal_paths AS (
    SELECT
        path,
        municipalities,
        time_schedule,
        travel_time,
        len(provinces) AS m_p,
        array_agg(municipalities) OVER (ORDER BY m_p desc rows between unbounded preceding and 1 preceding) as m_m,
        number_of_monuments
    FROM distinct_paths
)

SELECT
    path,
    time_schedule,
    len(list_intersect(municipalities, flatten(m_m))) as no_overlaps
FROM optimal_paths
ORDER BY no_overlaps ASC, number_of_monuments DESC, travel_time;
