SELECT
  emp_id AS user_id,
  CASE
    WHEN avg_price < 200 THEN '经济住宿'
    WHEN avg_price BETWEEN 200 AND 400  THEN '标准住宿'
    WHEN avg_price BETWEEN 400 AND 600  THEN '商务住宿'
    WHEN avg_price > 600 THEN '高端住宿'
    ELSE '未知'
  END AS 酒店价格偏好标签
FROM
  v_employee_travel_profile