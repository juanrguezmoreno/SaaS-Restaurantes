package com.restaurante.security.jwt;

import com.restaurante.user.entity.User;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import io.jsonwebtoken.security.SignatureException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class JwtTokenProvider {

    private final SecretKey secretKey;
    private final long expirationMs;

    public JwtTokenProvider(
            @Value("${app.jwt.secret:}") String secret,
            @Value("${app.jwt.expiration-ms}") long expirationMs) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "JWT_SECRET no está configurado. Define la variable de entorno JWT_SECRET " +
                    "con un valor secreto de al menos 32 caracteres antes de arrancar la aplicación.");
        }
        if (secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "JWT_SECRET es demasiado corto: se requieren al menos 32 bytes (256 bits) para HS256.");
        }
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    public String generateToken(User user) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expirationMs);

        Set<String> roles = user.getRoles().stream()
                .map(role -> role.getName().name())
                .collect(Collectors.toSet());

        List<Long> assignedRestaurantIds = user.getAssignedRestaurants() != null
                ? user.getAssignedRestaurants().stream().map(r -> r.getId()).collect(Collectors.toList())
                : List.of();

        return Jwts.builder()
                .subject(user.getUsername())
                .claim("userId", user.getId())
                .claim("email", user.getEmail())
                .claim("roles", String.join(",", roles))
                .claim("restaurantId", user.getRestaurant() != null ? user.getRestaurant().getId() : null)
                .claim("tenantId", user.getTenant() != null ? user.getTenant().getId() : null)
                .claim("assignedRestaurantIds", assignedRestaurantIds)
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(secretKey)
                .compact();
    }

    public String getUsernameFromToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();
    }

    public Long getUserIdFromToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get("userId", Long.class);
    }

    public Long getRestaurantIdFromToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get("restaurantId", Long.class);
    }

    public String getEmailFromToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get("email", String.class);
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token);
            return true;
        } catch (SignatureException e) {
            // Log: Firma JWT inválida
        } catch (MalformedJwtException e) {
            // Log: Token JWT malformado
        } catch (ExpiredJwtException e) {
            // Log: Token JWT expirado
        } catch (UnsupportedJwtException e) {
            // Log: Token JWT no soportado
        } catch (IllegalArgumentException e) {
            // Log: Argumento inválido
        }
        return false;
    }
}
