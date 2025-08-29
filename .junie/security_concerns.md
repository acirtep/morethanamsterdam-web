# Security Assessment: Netherlands Day Trip Planner

**Assessment Date:** 2025-08-19  
**Application:** morethanamsterdam-web  
**Assessment Scope:** Complete application security review  

## Executive Summary

This security assessment evaluates a web-based train trip planning application for the Netherlands. The application consists of a frontend built with HTML/JavaScript, a data processing layer using SQL and DuckDB, and a CI/CD pipeline for data updates. While the application implements several security best practices, there are critical vulnerabilities that require immediate attention.

**Risk Level:** MEDIUM-HIGH

## Security Findings

### 1. CRITICAL - Insecure External Dependencies (CI/CD)

**File:** `.github/workflows/download_data.yml`  
**Severity:** Critical  
**Description:** The GitHub workflow installs DuckDB CLI via an insecure curl command without checksum verification.

```yaml
- name: Install DuckDB CLI
  run: |
    curl https://install.duckdb.org | sh
```

**Impact:** Supply chain attack vulnerability allowing malicious code execution in CI environment.  
**Recommendation:** Use package managers with checksum verification or pin specific versions with integrity checks.

### 2. HIGH - Unvalidated User Input in CI/CD

**File:** `.github/workflows/download_data.yml`  
**Severity:** High  
**Description:** User-provided input (`execution_date`) is directly interpolated into SQL execution without validation.

```yaml
/home/runner/.duckdb/cli/latest/duckdb -c "execute download_data('${{ github.event.inputs.execution_date }}')"
```

**Impact:** Potential command injection or SQL injection in CI environment.  
**Recommendation:** Implement input validation and sanitization for workflow inputs.

### 3. HIGH - Insecure External Data Source

**File:** `etl/download_data.sql`  
**Severity:** High  
**Description:** Application downloads data from external URL without SSL certificate verification or integrity checks.

```sql
FROM read_csv('https://opendata.rijdendetreinen.nl/public/services/services-'||strftime($1::date, '%Y-%m')||'.csv.gz')
```

**Impact:** Man-in-the-middle attacks could inject malicious data into the application.  
**Recommendation:** Implement SSL certificate pinning and data integrity verification.

### 4. MEDIUM - Overprivileged CI/CD Permissions

**File:** `.github/workflows/download_data.yml`  
**Severity:** Medium  
**Description:** Workflow has broad `contents: write` permissions.

**Impact:** If compromised, the workflow could modify any repository content.  
**Recommendation:** Use minimal required permissions and consider using separate deployment keys.

### 5. MEDIUM - Content Security Policy Weaknesses

**File:** `index.html`  
**Severity:** Medium  
**Description:** CSP allows `unsafe-inline` for scripts and styles, and allows multiple external domains.

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://extensions.duckdb.org; worker-src blob:; object-src 'none'; base-uri 'self'; form-action 'self';" />
```

**Impact:** Reduced protection against XSS attacks and dependency confusion.  
**Recommendation:** Remove `unsafe-inline`, implement nonce-based CSP, and restrict external domains.

### 6. LOW - External CDN Dependencies

**File:** `index.html`  
**Severity:** Low  
**Description:** Application loads JavaScript and CSS from external CDNs (unpkg.com, cdn.jsdelivr.net).

**Impact:** Dependency on third-party services and potential supply chain risks.  
**Recommendation:** Consider hosting dependencies locally or using Subresource Integrity (SRI) hashes.

## Security Strengths

The application demonstrates several good security practices:

1. **Input Validation:** Comprehensive CSV parsing with injection protection in `src/data.js`
2. **Data Sanitization:** HTML entity sanitization for station names and codes
3. **Coordinate Validation:** Geographic bounds checking for Netherlands coordinates
4. **File Size Limits:** 1MB limit on CSV files to prevent DoS attacks
5. **Parameterized Queries:** SQL uses prepared statements with parameters
6. **Error Handling:** Proper error handling without information leakage

## Data Security Assessment

### Data Storage
- Train schedule data stored in Parquet format (appropriate for analytics)
- No personally identifiable information (PII) detected in data files
- Historical data only, no real-time sensitive information

### Data Processing
- SQL macros use parameterized inputs
- Data filtering and validation implemented
- No direct database exposure to frontend

## Recommendations by Priority

### Immediate (Critical/High)
1. Replace insecure DuckDB installation with verified package installation
2. Implement input validation for CI/CD workflow parameters
3. Add SSL certificate verification and data integrity checks for external data sources
4. Reduce CI/CD permissions to minimum required

### Short-term (Medium)
1. Strengthen Content Security Policy by removing `unsafe-inline`
2. Implement nonce-based CSP for inline scripts
3. Add Subresource Integrity hashes for external resources

### Long-term (Low)
1. Consider hosting external dependencies locally
2. Implement comprehensive security monitoring
3. Regular security dependency updates
4. Add automated security scanning to CI/CD pipeline

## Compliance Considerations

- **GDPR:** Application processes minimal personal data (station preferences stored locally)
- **Data Retention:** Historical data retention policy should be documented
- **Third-party Dependencies:** External service dependencies should be assessed for compliance

## Conclusion

While the application implements several security controls, critical vulnerabilities in the CI/CD pipeline and external dependency management pose significant risks. The frontend security is relatively robust with good input validation practices. Addressing the critical and high-severity findings should be prioritized to improve the overall security posture.

**Next Steps:**
1. Address critical CI/CD security issues immediately
2. Implement recommended security controls
3. Establish regular security review process
4. Consider implementing automated security testing

---
*This assessment was conducted on 2025-08-19 and reflects the security posture at the time of review.*