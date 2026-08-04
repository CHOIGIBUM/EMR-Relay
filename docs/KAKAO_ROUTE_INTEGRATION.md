# Kakao 지도·자동차 경로 연동

## 역할 분리

- 웹 지도 SDK는 `NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY`로 구급대원 화면에 현장·병원 마커와 선택 병원 경로를 그립니다. 이 키는 브라우저 공개 키이며 Kakao Developers에서 허용 도메인을 제한합니다.
- 자동차 길찾기는 `KAKAO_MOBILITY_REST_API_KEY`를 AWS Secrets Manager `ems-relay/external-api-keys`에 저장하고 Matching Lambda에서만 호출합니다.
- Kakao가 제공하는 거리·ETA는 병원 수용 가능성을 뜻하지 않습니다. NMC·HIRA로 확인된 기관 후보를 도로 이동시간 순으로 보여 주는 참고값입니다.

## 현재 운영 경로

```text
구급대원 모바일
  → AppSync requestHospitalMatching
  → SQS Matching Queue
  → Matching Lambda
  → NMC 기관 후보 + HIRA 기관 확인 + Kakao Mobility 거리·ETA
  → DynamoDB 요청 상태
  → AppSync 구독으로 구급대원·병원 화면 동기화
```

병원이 YES를 회신해도 자동으로 이송지가 확정되지는 않습니다. 구급대원이 수용 가능 기관 중 하나를 선택해야 하며, 선택 이후에만 Kakao 지도와 외부 길찾기 링크를 제공합니다.

## JavaScript SDK 도메인

Kakao Developers 앱의 `JavaScript SDK 도메인`에 실제 웹 원본(origin)을 등록해야 합니다.

```text
https://main.d1b1dqlcfz85e3.amplifyapp.com
```

도메인 등록은 코드 재배포 없이 적용됩니다. JavaScript 키 자체를 교체할 때만 `.env.production`과 Amplify 빌드를 갱신합니다.

## 실패 처리

- 지도 SDK가 거절되면 병원 목록, 실제 거리·ETA, 병원 요청·회신 기능은 계속 작동합니다.
- 지도 영역에는 명확한 오류 상태를 표시하고 `map.kakao.com/link/to` 길찾기 링크를 대체 수단으로 제공합니다.
- Kakao Directions 호출이 실패하면 임의 ETA를 만들지 않고 후보의 경로 상태를 저하(degraded)로 표시합니다.
- 정밀 GPS는 환자 카드의 임상 확정값이나 장기 보고서로 저장하지 않습니다.

공식 문서:

- [Kakao 지도 Web API 가이드](https://apis.map.kakao.com/web/guide/)
- [Kakao Mobility 자동차 길찾기](https://developers.kakaomobility.com/docs/navi-api/directions/)
