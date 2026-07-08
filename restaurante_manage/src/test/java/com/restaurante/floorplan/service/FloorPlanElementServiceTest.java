package com.restaurante.floorplan.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.floorplan.dto.FloorPlanElementMapper;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.entity.FloorPlanElement;
import com.restaurante.floorplan.enums.ElementType;
import com.restaurante.floorplan.repository.FloorPlanElementRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FloorPlanElementServiceTest {

    private static final Long RESTAURANT_ID = 1L;

    @Mock
    private FloorPlanElementRepository floorPlanElementRepository;

    @Mock
    private RestaurantRepository restaurantRepository;

    @Mock
    private CurrentUserService currentUserService;

    @Spy
    private FloorPlanElementMapper floorPlanElementMapper = new FloorPlanElementMapper();

    @InjectMocks
    private FloorPlanElementService service;

    private Restaurant restaurant;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
    }

    private void permitirAcceso() {
        when(currentUserService.canAccessRestaurant(RESTAURANT_ID)).thenReturn(true);
        when(restaurantRepository.findById(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
    }

    private FloorPlanElement elementoExistente(Long id, ElementType type, int x, int y) {
        FloorPlanElement element = new FloorPlanElement();
        element.setId(id);
        element.setRestaurant(restaurant);
        element.setType(type);
        element.setXPosition(x);
        element.setYPosition(y);
        element.setWidth(200);
        element.setHeight(60);
        element.setRotation(0);
        return element;
    }

    private FloorPlanElementRequest request(Long id, ElementType type, int x, int y) {
        FloorPlanElementRequest req = new FloorPlanElementRequest();
        req.setId(id);
        req.setType(type);
        req.setXPosition(x);
        req.setYPosition(y);
        req.setWidth(200);
        req.setHeight(60);
        req.setRotation(0);
        return req;
    }

    @Test
    void replaceElements_creaElementosNuevosSinId() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of());

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(null, ElementType.BAR, 100, 50)));

        assertEquals(1, result.size());
        assertEquals("BAR", result.get(0).getType());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FloorPlanElement>> captor = ArgumentCaptor.forClass(List.class);
        verify(floorPlanElementRepository).saveAll(captor.capture());
        FloorPlanElement guardado = captor.getValue().get(0);
        assertEquals(restaurant, guardado.getRestaurant());
        assertEquals(ElementType.BAR, guardado.getType());
        assertFalse(guardado.getDeleted());
    }

    @Test
    void replaceElements_actualizaElementosExistentesConId() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        FloorPlanElement existente = elementoExistente(5L, ElementType.DOOR, 0, 0);
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(existente));

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(5L, ElementType.DOOR, 300, 120)));

        assertEquals(1, result.size());
        assertEquals(300, existente.getXPosition());
        assertEquals(120, existente.getYPosition());
        assertFalse(existente.getDeleted());
    }

    @Test
    void replaceElements_softDeleteDeLosOmitidos() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        FloorPlanElement mantener = elementoExistente(5L, ElementType.BAR, 10, 10);
        FloorPlanElement eliminar = elementoExistente(6L, ElementType.DOOR, 20, 20);
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(mantener, eliminar));

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(5L, ElementType.BAR, 10, 10)));

        assertEquals(1, result.size());
        assertEquals(5L, result.get(0).getId());
        assertTrue(eliminar.getDeleted());
        assertNotNull(eliminar.getDeletedAt());
        assertFalse(mantener.getDeleted());
    }

    @Test
    void replaceElements_rechazaIdsDeOtroRestaurante() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of());

        assertThrows(BadRequestException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of(request(99L, ElementType.BAR, 0, 0))));
        verify(floorPlanElementRepository, never()).saveAll(anyList());
    }

    @Test
    void replaceElements_rechazaElementosSinCamposObligatorios() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));

        FloorPlanElementRequest sinTipo = request(null, null, 10, 10);

        assertThrows(BadRequestException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of(sinTipo)));
        verify(floorPlanElementRepository, never()).saveAll(anyList());
    }

    @Test
    void replaceElements_deniegaAccesoSinPermiso() {
        when(currentUserService.canAccessRestaurant(RESTAURANT_ID)).thenReturn(false);
        when(restaurantRepository.findById(RESTAURANT_ID)).thenReturn(Optional.empty());

        assertThrows(AccessDeniedException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of()));
    }

    @Test
    void findByRestaurantId_devuelveElementosMapeados() {
        permitirAcceso();
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(elementoExistente(5L, ElementType.BAR, 10, 10)));

        List<FloorPlanElementResponse> result = service.findByRestaurantId(RESTAURANT_ID);

        assertEquals(1, result.size());
        assertEquals("BAR", result.get(0).getType());
        assertEquals(RESTAURANT_ID, result.get(0).getRestaurantId());
    }
}
