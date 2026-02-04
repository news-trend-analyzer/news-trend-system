# 📰 News Trend System v2

> 여러 언론사의 RSS 뉴스를 수집하고, 기사 본문 기반으로 **실시간 트렌드 키워드 랭킹**을 계산하며  
> **DB 기반 데이터 리포트(추세/급상승/분포)** 까지 제공하는 뉴스 트렌드 분석 서비스

---

## 🔗 Links

- **Service URL**: https://trendlab.dev
- **Blog Series**: https://velog.io/@hyeok2/series/news-trend-system
- **Front GitHub**: https://github.com/news-trend-analyzer/new-trend-system-fe

> ✅ 현재 README는 v2 기준입니다.  
> v1 릴리즈(초기 MVP): `Releases > v1.0.0`

---

## 👀 Service Preview

실제 서비스 동작 화면 예시입니다.

<p align="center">
  <img src="https://github.com/user-attachments/assets/6a7788d4-ca9e-407f-96a7-83674d291fd9" width="32%" />
  <img src="https://github.com/user-attachments/assets/43781fb9-4c80-4e95-aa02-514dd7b7ac95" width="32%" />
  <img src="https://github.com/user-attachments/assets/ba90a572-06ef-4f97-9364-bd0c01765224" width="32%" />
  <img src="https://github.com/user-attachments/assets/e99ddef1-c68c-4ca1-84b9-0cb7214ebbb1" width="32%" />
</p>


- 실시간 트렌드 키워드 랭킹
- 키워드별 기사 리스트
- 검색어별 기사 리스트
- (v2) 키워드 데이터 리포트

---

## 📌 Introduction

뉴스는 대량으로 생산되지만,  
**지금 실제로 주목받는 이슈가 무엇인지**를 빠르게 파악하기는 어렵습니다.

News Trend System은 여러 언론사의 RSS를 기반으로 뉴스를 수집하고,  
기사 본문과 메타데이터를 분석하여 다음을 제공합니다.

- **실시간 트렌드 키워드 랭킹** (Redis 기반)
- **키워드 데이터 리포트(추세/급상승/분포)** (PostgreSQL 기반)
- **기사 검색/조회** (Elasticsearch 기반)

---

## 🆕 What's New in v2

v1은 “실시간 트렌드 랭킹 제공”에 집중했다면,  
v2는 “랭킹을 넘어 **리포트로 의미 있는 데이터 제공**”에 초점을 맞췄습니다.

### ✅ v2 핵심 변화
- PostgreSQL 도입: 트렌드 결과를 **time-series 형태로 저장**
- 키워드 데이터 리포트 API 추가
- Redis(실시간) / PostgreSQL(분석) 책임 분리

---

## ✨ Key Features

### 1) 실시간 트렌드 랭킹
- Trend 서비스가 기사 이벤트를 기반으로 키워드 점수를 계산
- Redis ZSET에 반영하여 실시간 TOP N 조회 제공

### 2) 키워드 데이터 리포트 (v2)
랭킹에 오른 키워드에 대해 아래와 같은 리포트를 제공합니다.

- 시간대별 언급량/점수 추세 (time-series)
- 급상승 키워드 감지 (최근 bucket 기준 증가율)
- 언론사 분포 / 기사 수

### 3) 기사 검색/조회
- Elasticsearch 기반으로 키워드/검색어별 기사 리스트 제공
- 트렌드 계산 로직과 조회 API의 책임 분리

---

## 🔄 Service Flow

뉴스 수집부터 트렌드 랭킹/리포트 제공까지의 전체 데이터 흐름입니다.

<p align="center">
  <img src="https://github.com/user-attachments/assets/d457ea7c-ff0e-45b9-a119-c1913194090e" width="80%" />
</p>

### Collector
- RSS 수집
- 본문 스크래핑
- 기사 데이터 Elasticsearch 인덱싱
- 기사 이벤트를 Queue(BullMQ)로 전달

### Trend
- Queue로 전달된 기사 기반 키워드 추출 및 점수 계산
- Redis ZSET을 통해 실시간 랭킹 제공
- (v2) Bucket 단위 집계 결과를 PostgreSQL에 저장하여 리포트 제공

---

## 🏗 System Architecture

AWS EC2 환경에서 Docker Compose 기반으로 배포된 시스템 구성입니다.

<p align="center">
  <img src="https://github.com/user-attachments/assets/f771f852-1e65-46f7-b811-8368d3a36daa" width="80%" />
</p>

---

## 🧠 Design Decisions

### 1) Redis 기반 실시간 랭킹
랭킹 조회는 트래픽이 가장 많고 지연 시간에 민감합니다.  
따라서 DB 반복 접근을 피하고, Redis ZSET을 활용해 빠른 정렬/조회가 가능하도록 설계했습니다.

- 실시간 랭킹 조회 시 DB 반복 접근 병목 방지
- ZSET을 활용한 점수 기반 정렬 및 TOP N 조회 구현

---

### 2) Queue 기반 비동기 처리
뉴스 수집과 트렌드 계산을 완전히 분리하여
- 수집 트래픽 증가에도 트렌드 서비스 안정성 유지
- 서비스 장애 시에도 재시도/재처리 가능한 구조 확보

---

### 3) PostgreSQL 기반 Report 저장 (v2 핵심)
Redis는 실시간 랭킹에 강하지만, **추세/비교/리포트 제공에는 한계**가 있습니다.

v2에서는 트렌드 집계 결과를 PostgreSQL에 저장해
- time-series 기반 추세 리포트 제공
- 급상승 감지/분석 지표 계산
- 분석 데이터의 정합성 및 지속성 확보

---

### 4) Elasticsearch 도입
- 원본 기사 데이터 검색 및 분석 전용
- 트렌드 계산 로직과 기사 조회 API 책임 분리

---

## 🗃 Data Model (v2)

v2에서 리포트 제공을 위해 핵심적으로 설계된 테이블은 다음과 같습니다.

<p align="center">
  <img src="https://github.com/user-attachments/assets/f141cc30-f2be-48d3-8af9-8bb4b619a612" width="80%" />
</p>

### keywords
- 단일 키워드 / 복합 키워드(Composite)를 포함하는 키워드 마스터 테이블

### keyword_timeseries
- 시간 bucket 단위로 키워드 빈도(freq), 점수(score_sum) 등을 저장
- “추세/급상승/리포트” 기능의 기반 데이터

> ✅ 실시간성은 Redis, 분석/리포트는 PostgreSQL이 담당하도록 역할을 분리했습니다.

---

## 🛠 Tech Stack

- **Language**: TypeScript  
- **Runtime / Framework**: Node.js, NestJS  
- **Queue / Cache / Ranking**: Redis, BullMQ  
- **DB (v2)**: PostgreSQL  
- **Search / Analytics**: Elasticsearch, Kibana  
- **Infra**: Docker, Docker Compose, AWS EC2  

---

## ✅ Why This Project Matters

이 프로젝트는 단순 크롤링이 아니라

- 큐 기반 비동기 파이프라인 설계
- Redis 기반 실시간 랭킹 시스템 구현
- PostgreSQL 기반 리포트(추세/급상승) 데이터 모델링
- Elasticsearch 기반 기사 검색/분석 분리

를 포함한 **운영 가능한 실무형 뉴스 데이터 처리 시스템**입니다.
