package com.restaurante.serviceperiod.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.dto.ServicePeriodMapper;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import com.restaurante.serviceperiod.repository.ServicePeriodRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ServicePeriodServiceTest {

    private static final Long RESTAURANT_ID = 1L;

    @Mock private ServicePeriodRepository servicePeriodRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private CurrentUserService currentUserService;

    private ServicePeriodService service;
    private Restaurant restaurante;

    @BeforeEach
    void setUp() {
        service = new ServicePeriodService(servicePeriodRepository, restaurantRepository,
                new ServicePeriodMapper(), currentUserService);

        restaurante = new Restaurant();
        restaurante.setId(RESTAURANT_ID);
        restaurante.setName("Horarios Test");

        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(Optional.of(restaurante));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of());
        when(servicePeriodRepository.saveAll(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private ServicePeriodRequest peticion(DayOfWeek dia, String inicio, String fin) {
        ServicePeriodRequest req = new ServicePeriodRequest();
        req.setDayOfWeek(dia);
        req.setStartTime(LocalTime.parse(inicio));
        req.setEndTime(LocalTime.parse(fin));
        return req;
    }

    @Test
    void guardaLosPeriodosDeUnDia() {
        List<ServicePeriodResponse> guardados = service.replacePeriods(RESTAURANT_ID, List.of(
                peticion(DayOfWeek.MONDAY, "20:00", "23:00"),
                peticion(DayOfWeek.MONDAY, "13:00", "16:00")));

        assertEquals(2, guardados.size());
        // Se devuelven ordenados por hora de inicio, no en el orden recibido.
        assertEquals(LocalTime.of(13, 0), guardados.get(0).getStartTime());
        assertEquals(LocalTime.of(20, 0), guardados.get(1).getStartTime());
    }

    @Test
    void rechazaPeriodosSolapadosDelMismoDia() {
        BadRequestException ex = assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(
                        peticion(DayOfWeek.MONDAY, "13:00", "16:00"),
                        peticion(DayOfWeek.MONDAY, "15:00", "18:00"))));

        assertTrue(ex.getMessage().contains("solapan"), "El mensaje debe explicar el solape: " + ex.getMessage());
        verify(servicePeriodRepository, never()).saveAll(any());
    }

    @Test
    void rechazaPeriodosDuplicados() {
        // Un duplicado exacto es un solape total: cae bajo la misma regla.
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(
                        peticion(DayOfWeek.TUESDAY, "13:00", "16:00"),
                        peticion(DayOfWeek.TUESDAY, "13:00", "16:00"))));
    }

    @Test
    void permiteElMismoHorarioEnDiasDistintos() {
        List<ServicePeriodResponse> guardados = service.replacePeriods(RESTAURANT_ID, List.of(
                peticion(DayOfWeek.MONDAY, "13:00", "16:00"),
                peticion(DayOfWeek.TUESDAY, "13:00", "16:00")));

        assertEquals(2, guardados.size());
    }

    @Test
    void rechazaInicioIgualAlFin() {
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "13:00", "13:00"))));
    }

    @Test
    void rechazaFinAnteriorAlInicio() {
        // Es también el caso de un periodo que cruzaría medianoche (20:00–01:00).
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "20:00", "01:00"))));
    }

    @Test
    void rechazaUnPeriodoSinDia() {
        ServicePeriodRequest sinDia = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        sinDia.setDayOfWeek(null);

        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(sinDia)));
    }

    @Test
    void rechazaUnIdQueNoPerteneceAlRestaurante() {
        ServicePeriodRequest ajeno = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        ajeno.setId(999L);

        BadRequestException ex = assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(ajeno)));

        assertTrue(ex.getMessage().contains("999"));
        verify(servicePeriodRepository, never()).saveAll(any());
    }

    @Test
    void rechazaUnIdRepetidoEnElMismoPayload() {
        ServicePeriodRequest primero = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        primero.setId(5L);
        ServicePeriodRequest segundo = peticion(DayOfWeek.TUESDAY, "13:00", "16:00");
        segundo.setId(5L);

        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(primero, segundo)));

        verify(servicePeriodRepository, never()).saveAll(any());
    }

    @Test
    void borraLogicamenteLosPeriodosNoIncluidos() {
        ServicePeriod existente = new ServicePeriod();
        existente.setId(7L);
        existente.setRestaurant(restaurante);
        existente.setDayOfWeek(DayOfWeek.MONDAY);
        existente.setStartTime(LocalTime.of(13, 0));
        existente.setEndTime(LocalTime.of(16, 0));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(existente));

        service.replacePeriods(RESTAURANT_ID, List.of());

        assertTrue(existente.getDeleted(), "El periodo ausente del payload debe quedar borrado lógicamente");
        assertNotNull(existente.getDeletedAt());
    }

    @Test
    void unNombreEnBlancoSeGuardaComoNulo() {
        ServicePeriodRequest conBlancos = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        conBlancos.setName("   ");

        service.replacePeriods(RESTAURANT_ID, List.of(conBlancos));

        ArgumentCaptor<List<ServicePeriod>> captor = ArgumentCaptor.forClass(List.class);
        verify(servicePeriodRepository).saveAll(captor.capture());
        assertNull(captor.getValue().get(0).getName());
    }

    @Test
    void validaElAccesoAlRestauranteAlLeerYAlGuardar() {
        service.findByRestaurantId(RESTAURANT_ID);
        service.replacePeriods(RESTAURANT_ID, List.of());

        verify(currentUserService, times(2)).validateRestaurantAccess(RESTAURANT_ID);
    }

    @Test
    void noGuardaNadaSiElAccesoEstaDenegado() {
        doThrow(new com.restaurante.common.exception.AccessDeniedException("denegado"))
                .when(currentUserService).validateRestaurantAccess(anyLong());

        assertThrows(com.restaurante.common.exception.AccessDeniedException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "13:00", "16:00"))));

        verify(servicePeriodRepository, never()).saveAll(any());
    }
}
